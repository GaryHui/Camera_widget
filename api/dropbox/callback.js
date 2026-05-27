import { exchangeDropboxCode, getCurrentDropboxAccount, getDropboxAppConfig } from "../../lib/dropbox.js";
import { deleteKey, getJson, saveDropboxConnection } from "../../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).send("Method not allowed");
    return;
  }

  try {
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    if (!code || !state) {
      res.status(400).send("Missing Dropbox code or state");
      return;
    }

    const stateKey = "dropbox:oauth-state:" + state;
    const stateData = await getJson(stateKey);
    if (!stateData || !stateData.installKey) {
      res.status(400).send("Dropbox connection expired. Please start again from the widget.");
      return;
    }

    const config = getDropboxAppConfig(req);
    const token = await exchangeDropboxCode(config, code);
    const account = await getCurrentDropboxAccount(token.access_token);

    await saveDropboxConnection(stateData.installKey, {
      refreshToken: token.refresh_token,
      accountId: token.account_id || account.account_id || "",
      accountName: account.name && account.name.display_name,
      accountEmail: account.email || ""
    });
    await deleteKey(stateKey);

    const target = new URL(stateData.returnTo || "/index.html", config.redirectUri);
    target.searchParams.set("dropbox", "connected");
    target.searchParams.set("installKey", stateData.installKey);
    res.redirect(302, target.toString());
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message || "Dropbox callback failed");
  }
}
