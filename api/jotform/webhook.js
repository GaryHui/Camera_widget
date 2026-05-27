import {
  ensureDropboxFolder,
  getDropboxAppConfig,
  getDropboxSharedUrl,
  refreshDropboxAccessToken,
  uploadDropboxFile
} from "../../lib/dropbox.js";
import { getDropboxConnection, safeInstallKey } from "../../lib/store.js";

function parseMaybeJson(value) {
  if (!value || typeof value !== "string") return null;

  try {
    return JSON.parse(value);
  } catch (_) {
    return null;
  }
}

function collectPayloads(value, output = []) {
  if (value == null) return output;

  if (typeof value === "string") {
    const parsed = parseMaybeJson(value);
    if (parsed) collectPayloads(parsed, output);
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloads(item, output));
    return output;
  }

  if (typeof value === "object") {
    output.push(value);
    Object.values(value).forEach((item) => collectPayloads(item, output));
  }

  return output;
}

function findFirstKey(value, keys) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  const stack = [value];

  while (stack.length) {
    const current = stack.shift();
    if (!current || typeof current !== "object") continue;

    for (const [key, item] of Object.entries(current)) {
      if (wanted.has(String(key).toLowerCase()) && item != null && String(item).trim()) {
        return String(item).trim();
      }
      if (item && typeof item === "object") stack.push(item);
    }
  }

  return "";
}

function parseProofCameraData(value) {
  if (!value) return null;

  if (typeof value === "object" && value.proofMode === "camera-only-9-photos-linked") {
    return value;
  }

  if (typeof value !== "string") return null;

  const direct = parseMaybeJson(value);
  if (direct && direct.proofMode === "camera-only-9-photos-linked") return direct;

  const marker = "Proof camera data:";
  const index = value.indexOf(marker);
  if (index < 0) return null;

  return parseMaybeJson(value.slice(index + marker.length).trim());
}

function findProofCameraData(body) {
  for (const item of collectPayloads(body)) {
    const proof = parseProofCameraData(item);
    if (proof && proof.proofMode === "camera-only-9-photos-linked") return proof;
  }

  return null;
}

function dropboxHomeUrl(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  return clean ? "https://www.dropbox.com/home/" + clean.split("/").map(encodeURIComponent).join("/") : null;
}

async function downloadJotformPdf({ formId, submissionId }) {
  const url = new URL("https://www.jotform.com/server.php");
  url.searchParams.set("action", "getSubmissionPDF");
  url.searchParams.set("sid", submissionId);
  url.searchParams.set("formID", formId);

  if (process.env.JOTFORM_API_KEY) {
    url.searchParams.set("apiKey", process.env.JOTFORM_API_KEY);
  }

  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  const isPdf = buffer.subarray(0, 4).toString("utf8") === "%PDF";

  if (!response.ok || !isPdf) {
    const error = new Error("Could not download Jotform submission PDF.");
    error.statusCode = 502;
    throw error;
  }

  return buffer;
}

async function updateJotformSubmissionLink({ submissionId, field, folderUrl }) {
  if (!process.env.JOTFORM_API_KEY || !field || !folderUrl) return null;

  const params = new URLSearchParams();
  params.set("apiKey", process.env.JOTFORM_API_KEY);
  params.set(`submission[${field}]`, folderUrl);

  const response = await fetch(`https://api.jotform.com/submission/${encodeURIComponent(submissionId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params.toString()
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.responseCode >= 400) {
    const error = new Error(payload.message || "Could not update Jotform Dropbox link field.");
    error.statusCode = 502;
    throw error;
  }

  return payload;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const rawRequest = parseMaybeJson(body.rawRequest) || {};
    const merged = { ...body, rawRequest };
    const proof = findProofCameraData(merged);

    if (!proof) {
      res.status(202).json({ ok: false, skipped: true, reason: "No proof camera data found." });
      return;
    }

    const formId = findFirstKey(merged, ["formID", "formId", "form_id"]) || proof.formId;
    const submissionId = findFirstKey(merged, ["submissionID", "submissionId", "submission_id", "sid"]) ||
      proof.submitter?.submissionId;

    if (!formId || !submissionId) {
      res.status(400).json({ error: "Missing formID or submissionID from Jotform webhook." });
      return;
    }

    const installKey = safeInstallKey(proof.installKey || (formId ? "form-" + formId : ""));
    const folderPath = proof.dropboxFolderPath || proof.photos?.[0]?.folderKey;

    if (!installKey || !folderPath) {
      res.status(400).json({ error: "Missing Dropbox install key or folder path." });
      return;
    }

    const connection = await getDropboxConnection(installKey);
    if (!connection) {
      res.status(409).json({ error: "Dropbox is not connected for this form." });
      return;
    }

    const config = getDropboxAppConfig(req);
    const accessToken = await refreshDropboxAccessToken(config, connection.refreshToken);
    const pdf = await downloadJotformPdf({ formId, submissionId });
    const pdfPath = `${folderPath}/jotform-submission-${submissionId}.pdf`;
    const auditPath = `${folderPath}/jotform-submission-${submissionId}-webhook.json`;

    await ensureDropboxFolder(accessToken, folderPath);
    await uploadDropboxFile(accessToken, pdfPath, pdf, "application/pdf");
    await uploadDropboxFile(
      accessToken,
      auditPath,
      Buffer.from(JSON.stringify({
        formId,
        submissionId,
        captureToken: proof.captureToken,
        dropboxFolderPath: folderPath,
        uploadedAt: new Date().toISOString()
      }, null, 2)),
      "application/json"
    );

    const pdfUrl = await getDropboxSharedUrl(accessToken, pdfPath);
    let folderUrl = dropboxHomeUrl(folderPath);
    try {
      folderUrl = await getDropboxSharedUrl(accessToken, folderPath, { raw: false }) || folderUrl;
    } catch (error) {
      console.warn("dropbox_folder_link_failed", {
        message: error.message,
        dropboxStatus: error.dropboxStatus,
        dropboxPayload: error.dropboxPayload
      });
    }
    const jotformUpdate = await updateJotformSubmissionLink({
      submissionId,
      field: proof.dropboxField || process.env.JOTFORM_DROPBOX_FIELD || "",
      folderUrl
    });

    res.status(200).json({
      ok: true,
      provider: "dropbox",
      formId,
      submissionId,
      captureToken: proof.captureToken,
      pdfUrl,
      folderUrl,
      pdfPath,
      jotformUpdated: Boolean(jotformUpdate)
    });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("jotform_webhook_failed", {
      status,
      message: error.message,
      dropboxStatus: error.dropboxStatus,
      dropboxPayload: error.dropboxPayload
    });
    res.status(status).json({
      error: status >= 500 ? "Jotform webhook failed" : error.message,
      detail: error.message
    });
  }
}
