import crypto from "node:crypto";
import { getDropboxAppConfig } from "../../lib/dropbox.js";
import { safeInstallKey, setJson } from "../../lib/store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const installKey = safeInstallKey(req.query.installKey);
    if (!installKey) {
      res.status(400).send("Missing installKey");
      return;
    }

    const config = getDropboxAppConfig(req);
    const state = crypto.randomBytes(24).toString("base64url");
    const returnTo = String(req.query.returnTo || "/index.html").slice(0, 500);

    await setJson("dropbox:oauth-state:" + state, {
      installKey,
      returnTo,
      createdAt: new Date().toISOString()
    }, 600);

    const url = new URL("https://www.dropbox.com/oauth2/authorize");
    url.searchParams.set("client_id", config.appKey);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("token_access_type", "offline");
    url.searchParams.set("scope", "files.content.write sharing.write sharing.read");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", config.redirectUri);

    res.redirect(302, url.toString());
  } catch (error) {
    res.status(error.statusCode || 500).send(error.message || "Dropbox connect failed");
  }
}
