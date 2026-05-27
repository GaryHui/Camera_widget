export function getDropboxAppConfig(req) {
  const appKey = process.env.DROPBOX_APP_KEY;
  const appSecret = process.env.DROPBOX_APP_SECRET;

  if (!appKey || !appSecret) {
    const error = new Error("Missing DROPBOX_APP_KEY or DROPBOX_APP_SECRET");
    error.statusCode = 500;
    throw error;
  }

  return {
    appKey,
    appSecret,
    redirectUri: process.env.DROPBOX_REDIRECT_URI || defaultRedirectUri(req),
    baseFolder: process.env.DROPBOX_BASE_FOLDER || "/JotformProof"
  };
}

function defaultRedirectUri(req) {
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || "https";
  return `${proto}://${host}/api/dropbox/callback`;
}

export async function exchangeDropboxCode(config, code) {
  const params = new URLSearchParams();
  params.set("code", code);
  params.set("grant_type", "authorization_code");
  params.set("redirect_uri", config.redirectUri);

  const payload = await dropboxTokenRequest(config, params);

  if (!payload.refresh_token) {
    const error = new Error("Dropbox did not return a refresh token. Make sure token_access_type=offline is used.");
    error.statusCode = 500;
    throw error;
  }

  return payload;
}

export async function refreshDropboxAccessToken(config, refreshToken) {
  const params = new URLSearchParams();
  params.set("grant_type", "refresh_token");
  params.set("refresh_token", refreshToken);

  const payload = await dropboxTokenRequest(config, params);
  if (!payload.access_token) {
    const error = new Error("Dropbox token refresh failed");
    error.statusCode = 500;
    throw error;
  }

  return payload.access_token;
}

async function dropboxTokenRequest(config, params) {
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

  if (!response.ok) {
    const error = new Error(payload.error_description || payload.error || "Dropbox OAuth failed");
    error.statusCode = 500;
    throw error;
  }

  return payload;
}

export async function dropboxJson(path, accessToken, body) {
  const response = await fetch("https://api.dropboxapi.com/2/" + path, {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json"
    },
    body: JSON.stringify(body || {})
  });
  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    const error = new Error(payload.error_summary || payload.error_description || raw || JSON.stringify(payload) || "Dropbox API failed");
    error.statusCode = 500;
    error.dropboxStatus = response.status;
    error.dropboxPayload = payload || raw;
    throw error;
  }

  return payload;
}

export async function getCurrentDropboxAccount(accessToken) {
  return dropboxJson("users/get_current_account", accessToken, {});
}

export async function uploadDropboxFile(accessToken, path, buffer, contentType) {
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
  const raw = await response.text();
  const payload = parseJson(raw);

  if (!response.ok) {
    const error = new Error(payload.error_summary || payload.error_description || raw || JSON.stringify(payload) || "Dropbox upload failed");
    error.statusCode = 500;
    error.dropboxStatus = response.status;
    error.dropboxPayload = payload || raw;
    throw error;
  }

  return {
    ...payload,
    contentType
  };
}

function parseJson(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

export async function ensureDropboxFolder(accessToken, path) {
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

export async function getDropboxSharedUrl(accessToken, path) {
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
