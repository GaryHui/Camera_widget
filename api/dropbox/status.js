import { getDropboxConnection, safeInstallKey } from "../../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const installKey = safeInstallKey(req.query.installKey);
    if (!installKey) {
      res.status(400).json({ connected: false, error: "Missing installKey" });
      return;
    }

    const connection = await getDropboxConnection(installKey);
    res.status(200).json({
      connected: Boolean(connection),
      installKey,
      accountId: connection && connection.accountId,
      accountName: connection && connection.accountName,
      accountEmail: connection && connection.accountEmail,
      connectedAt: connection && connection.connectedAt
    });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({
      connected: false,
      error: status >= 500 ? "Dropbox status failed" : error.message
    });
  }
}
