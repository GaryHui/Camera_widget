import { deleteKey, safeInstallKey } from "../../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const installKey = safeInstallKey((req.body && req.body.installKey) || req.query.installKey);
    if (!installKey) {
      res.status(400).json({ ok: false, error: "Missing installKey" });
      return;
    }

    await deleteKey("dropbox:connection:" + installKey);
    res.status(200).json({ ok: true, disconnected: true, installKey });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || "Dropbox disconnect failed"
    });
  }
}
