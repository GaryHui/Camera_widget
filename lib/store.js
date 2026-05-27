import crypto from "node:crypto";

function getKvConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    const error = new Error("Missing KV_REST_API_URL/KV_REST_API_TOKEN or UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN");
    error.statusCode = 500;
    throw error;
  }

  return {
    url: url.replace(/\/+$/, ""),
    token
  };
}

async function redis(command) {
  const config = getKvConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: "Bearer " + config.token,
      "content-type": "application/json"
    },
    body: JSON.stringify(command)
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok || payload.error) {
    const error = new Error(payload.error || "KV command failed");
    error.statusCode = 500;
    throw error;
  }

  return payload.result;
}

function secretKey() {
  if (!process.env.OAUTH_SECRET) {
    const error = new Error("Missing OAUTH_SECRET");
    error.statusCode = 500;
    throw error;
  }

  return crypto.createHash("sha256").update(process.env.OAUTH_SECRET).digest();
}

export function safeInstallKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._:-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

export function encryptText(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptText(value) {
  const [ivText, tagText, encryptedText] = String(value || "").split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    secretKey(),
    Buffer.from(ivText, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export async function setJson(key, value, ttlSeconds) {
  const command = ttlSeconds
    ? ["SET", key, JSON.stringify(value), "EX", ttlSeconds]
    : ["SET", key, JSON.stringify(value)];
  await redis(command);
}

export async function getJson(key) {
  const result = await redis(["GET", key]);
  if (!result) return null;
  return JSON.parse(result);
}

export async function deleteKey(key) {
  await redis(["DEL", key]);
}

export async function saveDropboxConnection(installKey, data) {
  const key = safeInstallKey(installKey);
  if (!key) {
    const error = new Error("Missing install key");
    error.statusCode = 400;
    throw error;
  }

  await setJson("dropbox:connection:" + key, {
    ...data,
    refreshToken: encryptText(data.refreshToken),
    connectedAt: new Date().toISOString()
  });
}

export async function getDropboxConnection(installKey) {
  const key = safeInstallKey(installKey);
  if (!key) return null;

  const data = await getJson("dropbox:connection:" + key);
  if (!data || !data.refreshToken) return null;

  return {
    ...data,
    refreshToken: decryptText(data.refreshToken)
  };
}
