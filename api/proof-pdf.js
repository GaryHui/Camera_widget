import {
  ensureDropboxFolder,
  getDropboxAppConfig,
  getDropboxSharedUrl,
  refreshDropboxAccessToken,
  uploadDropboxFile
} from "../lib/dropbox.js";
import { createProofPhotosPdf } from "../lib/proof-pdf.js";
import { getDropboxConnection, safeInstallKey } from "../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const proof = body.proof && typeof body.proof === "object" ? body.proof : null;

    if (!proof || proof.proofMode !== "camera-only-9-photos-linked") {
      res.status(400).json({ error: "Missing proof camera data." });
      return;
    }

    if (!Array.isArray(proof.photos) || proof.photos.length < 9) {
      res.status(400).json({ error: "Proof PDF requires all 9 uploaded photos." });
      return;
    }

    const installKey = safeInstallKey(proof.installKey || body.installKey || (proof.formId ? "form-" + proof.formId : ""));
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
    const pdf = await createProofPhotosPdf({
      proof,
      formId: proof.formId || body.formId || "",
      submissionId: body.submissionId || ""
    });
    const pdfPath = `${folderPath}/proof-photos-${proof.captureToken || Date.now()}.pdf`;

    await ensureDropboxFolder(accessToken, folderPath);
    await uploadDropboxFile(accessToken, pdfPath, pdf, "application/pdf");

    let pdfUrl = null;
    try {
      pdfUrl = await getDropboxSharedUrl(accessToken, pdfPath);
    } catch (error) {
      console.warn("proof_pdf_link_failed", {
        message: error.message,
        dropboxStatus: error.dropboxStatus,
        dropboxPayload: error.dropboxPayload
      });
    }

    res.status(200).json({
      ok: true,
      provider: "dropbox",
      installKey,
      pdfPath,
      pdfUrl,
      bytes: pdf.length,
      uploadedAt: new Date().toISOString()
    });
  } catch (error) {
    const status = error.statusCode || 500;
    console.error("proof_pdf_failed", {
      status,
      message: error.message,
      dropboxStatus: error.dropboxStatus,
      dropboxPayload: error.dropboxPayload
    });
    res.status(status).json({
      error: error.message || "Proof PDF failed",
      detail: error.message
    });
  }
}
