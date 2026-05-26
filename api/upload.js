import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import crypto from "node:crypto";

const s3RequiredEnv = [
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY"
];

function wantsDropbox() {
  return String(process.env.STORAGE_PROVIDER || "").toLowerCase() === "dropbox" ||
    Boolean(process.env.DROPBOX_ACCESS_TOKEN || process.env.DROPBOX_REFRESH_TOKEN);
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

function getDropboxConfig() {
  if (process.env.DROPBOX_ACCESS_TOKEN) {
    return {
      accessToken: process.env.DROPBOX_ACCESS_TOKEN,
      baseFolder: process.env.DROPBOX_BASE_FOLDER || "/JotformProof"
    };
  }

  const missing = ["DROPBOX_REFRESH_TOKEN", "DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"].filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error("Missing Dropbox environment variables: " + missing.join(", "));
    error.statusCode = 500;
    throw error;
  }

  return {
    refreshToken: process.env.DROPBOX_REFRESH_TOKEN,
    appKey: process.env.DROPBOX_APP_KEY,
    appSecret: process.env.DROPBOX_APP_SECRET,
    baseFolder: process.env.DROPBOX_BASE_FOLDER || "/JotformProof"
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

async function getDropboxAccessToken(config) {
  if (config.accessToken) return config.accessToken;

  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", config.refreshToken);

  const auth = Buffer.from(config.appKey + ":" + config.appSecret).toString("base64");
  const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: {
      authorization: "Basic " + auth,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || !payload.access_token) {
    const error = new Error("Dropbox token refresh failed");
    error.statusCode = 500;
    throw error;
  }

  return payload.access_token;
}

async function dropboxJson(path, accessToken, body) {
  const response = await fetch("https://api.dropboxapi.com/2/" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error_summary || "Dropbox API failed");
    error.statusCode = 500;
    throw error;
  }

  return payload;
}

async function uploadDropboxFile(accessToken, path, buffer, contentType) {
  const response = await fetch("https://content.dropboxapi.com/2/files/upload", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/octet-stream",
      "dropbox-api-arg": JSON.stringify({
        path,
        mode: "overwrite",
        autorename: false,
        mute: true
      })
    },
    body: buffer
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(payload.error_summary || "Dropbox upload failed");
    error.statusCode = 500;
    throw error;
  }

  return {
    ...payload,
    contentType
  };
}

async function ensureDropboxFolder(accessToken, path) {
  const clean = String(path || "").replace(/^\/+|\/+$/g, "");
  if (!clean) return;

  const parts = clean.split("/").filter(Boolean);
  let current = "";

  for (const part of parts) {
    current += "/" + part;
    try {
      await dropboxJson("files/create_folder_v2", accessToken, {
        path: current,
        autorename: false
      });
    } catch (error) {
      if (!String(error.message || "").includes("path/conflict/folder")) throw error;
    }
  }
}

async function getDropboxSharedUrl(accessToken, path) {
  try {
    const created = await dropboxJson("sharing/create_shared_link_with_settings", accessToken, {
      path,
      settings: {
        requested_visibility: "public",
        audience: "public",
        access: "viewer"
      }
    });
    return toRawDropboxUrl(created.url);
  } catch (error) {
    if (!String(error.message || "").includes("shared_link_already_exists")) throw error;
  }

  const existing = await dropboxJson("sharing/list_shared_links", accessToken, {
    path,
    direct_only: true
  });
  const link = existing.links && existing.links[0] && existing.links[0].url;
  return link ? toRawDropboxUrl(link) : null;
}

function toRawDropboxUrl(url) {
  if (!url) return null;
  return String(url).replace("www.dropbox.com", "dl.dropboxusercontent.com").replace(/[?&]dl=0$/, "");
}

async function uploadToDropbox({ body, image, imageKey, metadataKey, metadata, sha256 }) {
  const config = getDropboxConfig();
  const accessToken = await getDropboxAccessToken(config);
  const baseFolder = "/" + String(config.baseFolder || "/JotformProof").replace(/^\/+|\/+$/g, "");
  const imagePath = `${baseFolder}/${imageKey}`;
  const metadataPath = `${baseFolder}/${metadataKey}`;
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

  return {
    ok: true,
    provider: "dropbox",
    url,
    key: imagePath,
    metadataKey: metadataPath,
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
    const index = safePart(body.index, "0");
    const image = parseBase64Image(body.imageDataUrl);

    if (image.buffer.length > 8 * 1024 * 1024) {
      res.status(413).json({ error: "Image is too large" });
      return;
    }

    const sha256 = crypto.createHash("sha256").update(image.buffer).digest("hex");
    const ext = image.contentType === "image/png" ? "png" : image.contentType === "image/webp" ? "webp" : "jpg";
    const baseKey = `jotform-proof/${folder}/${token}/${String(index).padStart(2, "0")}-${photoKey}`;
    const imageKey = `${baseKey}.${ext}`;
    const metadataKey = `${baseKey}.json`;
    const metadata = {
      ...(body.metadata && typeof body.metadata === "object" ? body.metadata : {}),
      storage: {
        imageKey,
        metadataKey,
        sha256,
        bytes: image.buffer.length,
        contentType: image.contentType,
        uploadedAt: new Date().toISOString()
      }
    };

    const result = wantsDropbox()
      ? await uploadToDropbox({ body, image, imageKey, metadataKey, metadata, sha256 })
      : await uploadToS3({ image, imageKey, metadataKey, metadata, sha256, photoKey, token });

    res.status(200).json(result);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      error: status >= 500 ? "Upload failed" : error.message,
      detail: process.env.NODE_ENV === "development" ? error.message : undefined
    });
  }
}
