import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "node:crypto";
import {
  ensureDropboxFolder,
  getDropboxAppConfig,
  getDropboxSharedUrl,
  refreshDropboxAccessToken,
  uploadDropboxFile
} from "../lib/dropbox.js";
import { getDropboxConnection, safeInstallKey } from "../lib/store.js";

const s3RequiredEnv = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY"
];

function wantsDropbox(body) {
  return String(process.env.STORAGE_PROVIDER || "").toLowerCase() === "dropbox" ||
    Boolean(body.installKey || body.formId);
}

function getS3Config() {
  const missing = s3RequiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error("Missing storage environment variables: " + missing.join(", "));
    error.statusCode = 500;
    throw error;
  }

  return {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || "auto",
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || ""
  };
}

function safePart(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function parseBase64Image(value) {
  const text = String(value || "");
  const match = text.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/);

  if (!match) {
    const error = new Error("Invalid image data");
    error.statusCode = 400;
    throw error;
  }

  return {
    contentType: match[1] === "image/jpg" ? "image/jpeg" : match[1],
    buffer: Buffer.from(match[2], "base64")
  };
}

function publicUrl(config, key) {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl.replace(/\/+$/, "") + "/" + key.split("/").map(encodeURIComponent).join("/");
  }

  if (config.endpoint) {
    return null;
  }

  return `https://${config.bucket}.s3.${config.region}.amazonaws.com/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function uploadToDropbox({ req, body, image, imageKey, metadataKey, metadata, sha256 }) {
  const installKey = safeInstallKey(body.installKey || (body.formId ? "form-" + body.formId : ""));
  const connection = await getDropboxConnection(installKey);

  if (!connection) {
    const error = new Error("Dropbox is not connected for this form.");
    error.statusCode = 409;
    error.code = "dropbox_not_connected";
    throw error;
  }

  const config = getDropboxAppConfig(req);
  const accessToken = await refreshDropboxAccessToken(config, connection.refreshToken);
  const baseFolder = "/" + String(config.baseFolder || "/JotformProof").replace(/^\/+|\/+$/g, "");
  const imagePath = `${baseFolder}/${imageKey}`;
  const metadataPath = `${baseFolder}/${metadataKey}`;
  const submissionFolderPath = imagePath.slice(0, imagePath.lastIndexOf("/"));
  const folderPath = imagePath.slice(0, imagePath.lastIndexOf("/"));

  await ensureDropboxFolder(accessToken, folderPath);
  await uploadDropboxFile(accessToken, imagePath, image.buffer, image.contentType);
  await uploadDropboxFile(
    accessToken,
    metadataPath,
    Buffer.from(JSON.stringify(metadata, null, 2)),
    "application/json"
  );

  const url = await getDropboxSharedUrl(accessToken, imagePath);
  const folderUrl = await getDropboxSharedUrl(accessToken, submissionFolderPath, { raw: false });

  return {
    ok: true,
    provider: "dropbox",
    installKey,
    accountId: connection.accountId,
    accountEmail: connection.accountEmail,
    url,
    key: imagePath,
    metadataKey: metadataPath,
    folderKey: submissionFolderPath,
    folderUrl,
    sha256,
    bytes: image.buffer.length,
    contentType: image.contentType,
    uploadedAt: metadata.storage.uploadedAt
  };
}

async function uploadToS3({ image, imageKey, metadataKey, metadata, sha256, photoKey, token }) {
  const config = getS3Config();
  const client = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: Boolean(config.endpoint),
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: imageKey,
    Body: image.buffer,
    ContentType: image.contentType,
    Metadata: {
      sha256,
      photoKey,
      captureToken: token
    }
  }));

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: metadataKey,
    Body: JSON.stringify(metadata, null, 2),
    ContentType: "application/json"
  }));

  return {
    ok: true,
    provider: "s3",
    url: publicUrl(config, imageKey),
    key: imageKey,
    metadataKey,
    sha256,
    bytes: image.buffer.length,
    contentType: image.contentType,
    uploadedAt: metadata.storage.uploadedAt
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const token = safePart(body.captureToken, "capture");
    const folder = safePart(body.folder || (body.formId ? "form-" + body.formId : "default"), "default");
    const photoKey = safePart(body.photoKey, "photo");
    const submitterName = safePart(body.submitterName, "");
    const submitterEmail = safePart(body.submitterEmail, "");
    const submitterPrefix = [submitterName, submitterEmail].filter(Boolean).join("-");
    const index = safePart(body.index, "0");
    const image = parseBase64Image(body.imageDataUrl);

    if (image.buffer.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: "Image is too large" });
      return;
    }

    const sha256 = crypto.createHash("sha256").update(image.buffer).digest("hex");
    const ext = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
    const fileBase = [String(index).padStart(2, "0"), submitterPrefix, photoKey].filter(Boolean).join("-");
    const baseKey = `jotform-proof/${folder}/${token}/${fileBase}`;
    const imageKey = `${baseKey}.${ext}`;
    const metadataKey = `${baseKey}.json`;
    const folderKey = `jotform-proof/${folder}/${token}`;
    const metadata = {
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      storage: {
        imageKey,
        metadataKey,
        folderKey,
        sha256,
        bytes: image.buffer.length,
        contentType: image.contentType,
        uploadedAt: new Date().toISOString()
      }
    };

    const result = wantsDropbox(body)
      ? await uploadToDropbox({ req, body, image, imageKey, metadataKey, metadata, sha256 })
      : await uploadToS3({ image, imageKey, metadataKey, metadata, sha256, photoKey, token });

    res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("upload_failed", {
      status,
      code: error.code,
      message: error.message,
      dropboxStatus: error.dropboxStatus,
      dropboxPayload: error.dropboxPayload
    });
    res.status(status).json({
      error: status >= 500 ? "Upload failed" : error.message,
      code: error.code,
      detail: error.message
    });
  }
}
