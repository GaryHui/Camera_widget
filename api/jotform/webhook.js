import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
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

function safeText(value) {
  return String(value || "")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawWrappedText(page, text, options) {
  const {
    x,
    y,
    width,
    font,
    size,
    color = rgb(0.12, 0.16, 0.24),
    lineHeight = size + 4,
    maxLines = 8
  } = options;
  const words = safeText(text).split(" ").filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const next = line ? line + " " + word : word;
    if (font.widthOfTextAtSize(next, size) <= width) {
      line = next;
    } else {
      if (line) lines.push(line);
      line = word;
    }

    if (lines.length >= maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);

  lines.forEach((item, index) => {
    page.drawText(item, {
      x,
      y: y - index * lineHeight,
      size,
      font,
      color
    });
  });

  return y - lines.length * lineHeight;
}

async function fetchImageBytes(url) {
  if (!url) return null;

  const response = await fetch(url);
  if (!response.ok) return null;

  return Buffer.from(await response.arrayBuffer());
}

async function embedImage(pdfDoc, bytes) {
  if (!bytes) return null;

  try {
    return await pdfDoc.embedJpg(bytes);
  } catch (_) {
    try {
      return await pdfDoc.embedPng(bytes);
    } catch (_) {
      return null;
    }
  }
}

async function createProofPhotosPdf({ proof, formId, submissionId }) {
  const pdfDoc = await PDFDocument.create();
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const titleColor = rgb(0.04, 0.16, 0.38);
  const accent = rgb(0.02, 0.42, 0.88);

  const cover = pdfDoc.addPage([pageWidth, pageHeight]);
  cover.drawText("Proof Camera Photo Report", {
    x: margin,
    y: pageHeight - margin - 10,
    size: 24,
    font: bold,
    color: titleColor
  });
  cover.drawText("Jotform submission and camera-only photo evidence", {
    x: margin,
    y: pageHeight - margin - 40,
    size: 11,
    font: regular,
    color: rgb(0.32, 0.38, 0.48)
  });

  const submitter = proof.submitter || {};
  const coverLines = [
    ["Form ID", formId],
    ["Submission ID", submissionId],
    ["Capture token", proof.captureToken],
    ["Completed at", proof.completedAt],
    ["Submitter", [submitter.name, submitter.email].filter(Boolean).join(" / ")],
    ["Dropbox folder", proof.dropboxFolderUrl || proof.dropboxFolderPath]
  ];
  let coverY = pageHeight - margin - 90;
  coverLines.forEach(([label, value]) => {
    cover.drawText(label + ":", {
      x: margin,
      y: coverY,
      size: 10,
      font: bold,
      color: rgb(0.24, 0.28, 0.36)
    });
    drawWrappedText(cover, value || "-", {
      x: margin + 95,
      y: coverY,
      width: pageWidth - margin * 2 - 95,
      font: regular,
      size: 10,
      maxLines: 2
    });
    coverY -= 28;
  });

  cover.drawText("Photos", {
    x: margin,
    y: coverY - 14,
    size: 15,
    font: bold,
    color: titleColor
  });
  coverY -= 42;

  (proof.photos || []).forEach((photo) => {
    coverY = drawWrappedText(cover, `${photo.index}. ${photo.label} - ${photo.sha256 || ""}`, {
      x: margin,
      y: coverY,
      width: pageWidth - margin * 2,
      font: regular,
      size: 9,
      maxLines: 2
    }) - 4;
  });

  for (const photo of proof.photos || []) {
    const page = pdfDoc.addPage([pageWidth, pageHeight]);
    page.drawText(`${photo.index}. ${safeText(photo.label)}`, {
      x: margin,
      y: pageHeight - margin,
      size: 17,
      font: bold,
      color: titleColor
    });
    page.drawLine({
      start: { x: margin, y: pageHeight - margin - 12 },
      end: { x: pageWidth - margin, y: pageHeight - margin - 12 },
      thickness: 1.2,
      color: accent
    });

    const image = await embedImage(pdfDoc, await fetchImageBytes(photo.url));
    if (image) {
      const box = {
        x: margin,
        y: 230,
        width: pageWidth - margin * 2,
        height: 470
      };
      const scale = Math.min(box.width / image.width, box.height / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, {
        x: box.x + (box.width - width) / 2,
        y: box.y + (box.height - height) / 2,
        width,
        height
      });
    } else {
      page.drawText("Photo could not be embedded. Use the URL below.", {
        x: margin,
        y: 480,
        size: 12,
        font: bold,
        color: rgb(0.7, 0.1, 0.1)
      });
    }

    const meta = photo.metadata || {};
    const location = meta.location || {};
    const time = meta.time || {};
    const gps = location.latitude && location.longitude
      ? `${location.latitude}, ${location.longitude} +/- ${Math.round(location.accuracy || 0)}m`
      : "-";

    let y = 190;
    [
      ["Captured time", time.local || time.iso || "-"],
      ["GPS", gps],
      ["SHA-256", photo.sha256 || "-"],
      ["Dropbox photo URL", photo.url || "-"]
    ].forEach(([label, value]) => {
      page.drawText(label + ":", {
        x: margin,
        y,
        size: 9,
        font: bold,
        color: rgb(0.24, 0.28, 0.36)
      });
      y = drawWrappedText(page, value, {
        x: margin + 105,
        y,
        width: pageWidth - margin * 2 - 105,
        font: regular,
        size: 8,
        maxLines: 3
      }) - 8;
    });
  }

  return Buffer.from(await pdfDoc.save());
}

async function mergePdfBuffers(buffers) {
  const output = await PDFDocument.create();

  for (const buffer of buffers.filter(Boolean)) {
    const source = await PDFDocument.load(buffer);
    const pages = await output.copyPages(source, source.getPageIndices());
    pages.forEach((page) => output.addPage(page));
  }

  return Buffer.from(await output.save());
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

async function findJotformFieldByLabel(formId, labels) {
  if (!process.env.JOTFORM_API_KEY || !formId) return "";

  const wanted = labels.map((label) => String(label).toLowerCase());
  const url = new URL(`https://api.jotform.com/form/${encodeURIComponent(formId)}/questions`);
  url.searchParams.set("apiKey", process.env.JOTFORM_API_KEY);

  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  const questions = payload.content || {};

  if (!response.ok || payload.responseCode >= 400) {
    const error = new Error(payload.message || "Could not read Jotform fields.");
    error.statusCode = 502;
    throw error;
  }

  for (const [qid, question] of Object.entries(questions)) {
    const values = [
      question.text,
      question.name,
      question.label,
      question.title
    ].filter(Boolean).map((value) => String(value).toLowerCase());

    if (values.some((value) => wanted.includes(value))) return qid;
  }

  return "";
}

async function updateJotformSubmissionLink({ formId, submissionId, field, folderUrl }) {
  if (!process.env.JOTFORM_API_KEY || !folderUrl) return null;

  const resolvedField = field || await findJotformFieldByLabel(formId, [
    "Dropbox Link",
    "Dropbox",
    "dropboxLink",
    "dropbox_link"
  ]);
  if (!resolvedField) return null;

  const params = new URLSearchParams();
  params.set("apiKey", process.env.JOTFORM_API_KEY);
  params.set(`submission[${resolvedField}]`, folderUrl);

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

  return {
    ...payload,
    field: resolvedField
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
    const pdfPath = `${folderPath}/jotform-submission-${submissionId}.pdf`;
    const proofPhotosPdfPath = `${folderPath}/proof-photos-${submissionId}.pdf`;
    const combinedPdfPath = `${folderPath}/jotform-submission-with-photos-${submissionId}.pdf`;
    const auditPath = `${folderPath}/jotform-submission-${submissionId}-webhook.json`;

    await ensureDropboxFolder(accessToken, folderPath);
    let pdfUrl = null;
    let combinedPdfUrl = null;
    let jotformPdf = null;
    let jotformPdfUploaded = false;
    try {
      jotformPdf = await downloadJotformPdf({ formId, submissionId });
      await uploadDropboxFile(accessToken, pdfPath, jotformPdf, "application/pdf");
      pdfUrl = await getDropboxSharedUrl(accessToken, pdfPath);
      jotformPdfUploaded = true;
    } catch (error) {
      console.warn("jotform_pdf_upload_skipped", {
        message: error.message
      });
    }

    const proofPhotosPdf = await createProofPhotosPdf({ proof, formId, submissionId });
    await uploadDropboxFile(accessToken, proofPhotosPdfPath, proofPhotosPdf, "application/pdf");
    if (jotformPdf) {
      const combinedPdf = await mergePdfBuffers([jotformPdf, proofPhotosPdf]);
      await uploadDropboxFile(accessToken, combinedPdfPath, combinedPdf, "application/pdf");
      combinedPdfUrl = await getDropboxSharedUrl(accessToken, combinedPdfPath);
    }
    await uploadDropboxFile(
      accessToken,
      auditPath,
      Buffer.from(JSON.stringify({
        formId,
        submissionId,
        captureToken: proof.captureToken,
        dropboxFolderPath: folderPath,
        jotformPdfPath: jotformPdfUploaded ? pdfPath : "",
        proofPhotosPdfPath,
        combinedPdfPath: jotformPdfUploaded ? combinedPdfPath : "",
        uploadedAt: new Date().toISOString()
      }, null, 2)),
      "application/json"
    );

    const proofPhotosPdfUrl = await getDropboxSharedUrl(accessToken, proofPhotosPdfPath);
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
      formId,
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
      proofPhotosPdfUrl,
      combinedPdfUrl,
      folderUrl,
      pdfPath,
      proofPhotosPdfPath,
      combinedPdfPath: jotformPdfUploaded ? combinedPdfPath : "",
      jotformPdfUploaded,
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
