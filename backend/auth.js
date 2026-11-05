const crypto = require("crypto");

const TOKEN_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const TOKEN_SECRET = process.env.TASKHERO_SESSION_SECRET ||
  (process.env.NODE_ENV !== "production" ? "taskhero-local-development-secret" : null);

if (!TOKEN_SECRET) throw new Error("TASKHERO_SESSION_SECRET must be configured in production.");

function sessionSecret() {
  return TOKEN_SECRET;
}

function createSessionToken(userId) {
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    exp: Math.floor(Date.now() / 1000) + TOKEN_LIFETIME_SECONDS,
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function readSessionToken(token) {
  if (typeof token !== "string") return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined) return null;

  const expected = crypto.createHmac("sha256", sessionSecret()).update(payload).digest();
  let actual;
  try {
    actual = Buffer.from(signature, "base64url");
  } catch {
    return null;
  }
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof claims.sub !== "string" || !claims.sub || !Number.isInteger(claims.exp)) return null;
    if (claims.exp <= Math.floor(Date.now() / 1000)) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

function requireSession(req, res, next) {
  const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
  const userId = match ? readSessionToken(match[1]) : null;
  if (!userId) return res.status(401).json({ success: false, message: "Sign in to continue." });
  req.user = { id: userId };
  next();
}

function optionalSession(req, res, next) {
  const match = /^Bearer (.+)$/i.exec(req.get("authorization") || "");
  const userId = match ? readSessionToken(match[1]) : null;
  if (userId) req.user = { id: userId };
  next();
}

module.exports = { createSessionToken, readSessionToken, requireSession, optionalSession };