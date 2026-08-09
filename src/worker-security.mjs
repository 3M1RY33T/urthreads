/**
 * Pure security helpers for the urthreads worker.
 *
 * Kept free of worker-specific IO (D1, audit logging, routing) so the helpers
 * can be unit-tested directly (see test/worker-security.test.mjs). The worker
 * (src/worker.js) imports these and owns the Cloudflare runtime concerns.
 */

const ADMIN_SESSION_COOKIE_NAME = "__Host-urthreads_admin_session";
const DEFAULT_ADMIN_SESSION_TTL_SECONDS = 60 * 60;
const MIN_ADMIN_SESSION_TTL_SECONDS = 15 * 60;
const MAX_ADMIN_SESSION_TTL_SECONDS = 60 * 60;
const ADMIN_MUTATION_COMMENT_ACTIONS = new Set(["approve", "reject", "hide", "unhide", "delete"]);

function safeParseUrl(value) {
  try {
    return new URL(value);
  } catch (error) {
    return null;
  }
}

/**
 * True for the admin request paths: the session endpoint and everything under
 * /admin/. Accepts a URL object (or null).
 */
export function isAdminRequestPath(url) {
  if (!url) return false;
  const pathname = url.pathname;
  return pathname === "/admin/session" || pathname.startsWith("/admin/");
}

/**
 * Admin mutations that must be CSRF-checked. Reads (GET) need no CSRF check:
 * CORS already prevents cross-origin reads of the response.
 */
export function isAdminMutation(request, url) {
  const method = request.method;
  const pathname = url.pathname;

  if (pathname === "/admin/session") {
    return method === "POST" || method === "DELETE";
  }

  if (pathname === "/admin/comment-settings") {
    return method === "POST" || method === "PUT";
  }

  if (pathname.startsWith("/admin/comments/")) {
    const action = pathname.slice("/admin/comments/".length);
    return method === "POST" && ADMIN_MUTATION_COMMENT_ACTIONS.has(action);
  }

  return false;
}

/**
 * Get CORS headers based on origin.
 *
 * Admin routes never reflect "*" back to the browser: when only a wildcard is
 * configured and no exact origin matches, no Access-Control-Allow-Origin header
 * is emitted at all, so credentialed cross-origin requests fail preflight.
 * Exact origins still get ACAO + Access-Control-Allow-Credentials for admin and
 * public routes.
 */
export function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";

  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const hasWildcardOrigin = allowedOrigins.includes("*");
  const hasExactOrigin = allowedOrigins.includes(origin);

  if (hasExactOrigin) {
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, X-Admin-Key",
      "Vary": "Origin",
    };

    if (origin) {
      headers["Access-Control-Allow-Credentials"] = "true";
    }

    return headers;
  }

  if (hasWildcardOrigin && !isAdminRequestPath(safeParseUrl(request.url))) {
    return {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, X-Admin-Key",
      "Vary": "Origin",
    };
  }

  return {
    "Vary": "Origin",
  };
}

/**
 * Cross-site request forgery guard for admin mutations.
 *
 * A Content-Type: text/plain body is a CORS-safelisted "simple request" — no
 * preflight fires — so the browser attaches a SameSite=None cookie cross-site
 * and request.json() parses the body regardless of content type. The Origin
 * header (always sent by browsers on cross-origin POSTs, including simple ones)
 * is the discriminator. Missing Origin means a non-browser client (curl/CLI)
 * and is allowed; a present Origin must be the worker's own origin or an exact
 * ALLOWED_ORIGINS entry. A wildcard-only configuration never satisfies the
 * check for a browser request.
 */
export function checkCsrf(request, env) {
  const origin = String(request.headers.get("Origin") || "");
  if (!origin) {
    return { allowed: true, reason: "missing_origin" };
  }

  const parsedUrl = safeParseUrl(request.url);
  if (parsedUrl && origin === parsedUrl.origin) {
    return { allowed: true, reason: "same_origin" };
  }

  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(origin)) {
    return { allowed: true, reason: "allowed_origin" };
  }

  return { allowed: false, reason: "forbidden_origin" };
}

/**
 * Client IP for rate limiting and audit logging. Only the Cloudflare-provided
 * CF-Connecting-IP is trusted; X-Forwarded-For is client-suppliable and is
 * never read. Falls back to 'local' for loopback hosts and 'unknown' otherwise.
 */
export function getClientIp(request) {
  const connectingIp = String(request.headers.get("CF-Connecting-IP") || "")
    .trim()
    .slice(0, 128);
  if (connectingIp) return connectingIp;

  const parsedUrl = safeParseUrl(request.url);
  const hostname = parsedUrl ? parsedUrl.hostname : "";
  const localHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
  return localHostnames.has(hostname) ? "local" : "unknown";
}

/**
 * Failed-login rate limiter.
 *
 * Counts FAILED attempts only within a sliding window (window_start is set to
 * now on the first failure in a window). When a key reaches maxFailures it is
 * locked out until now + windowMs. `state` is an injectable Map so tests can
 * drive the limiter deterministically; `now` may be a clock function or a fixed
 * timestamp.
 */
export function createAdminRateLimiter(options = {}) {
  const maxFailures = Number(options.maxFailures) > 0 ? Number(options.maxFailures) : 5;
  const windowMs = Number(options.windowMs) > 0 ? Number(options.windowMs) : 15 * 60 * 1000;
  const state = options.state instanceof Map ? options.state : new Map();
  const clock =
    typeof options.now === "function"
      ? options.now
      : () => (Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now());

  function getBlockState(key) {
    const entry = state.get(key);
    if (!entry) return null;
    const currentTime = clock();
    const lockedOut = Boolean(entry.lockoutUntil && entry.lockoutUntil > currentTime);
    const windowActive = currentTime - entry.windowStart < windowMs;
    if (!lockedOut && !(windowActive && entry.count >= maxFailures)) {
      return null;
    }
    const until = lockedOut ? entry.lockoutUntil : entry.windowStart + windowMs;
    return {
      retryAfterSeconds: Math.max(1, Math.ceil((until - currentTime) / 1000)),
    };
  }

  function isBlocked(key) {
    return Boolean(getBlockState(key));
  }

  function getRetryAfterSeconds(key) {
    const blockState = getBlockState(key);
    return blockState ? blockState.retryAfterSeconds : 0;
  }

  function recordFailure(key) {
    const currentTime = clock();
    let entry = state.get(key);
    const lockedOut = Boolean(entry?.lockoutUntil && entry.lockoutUntil > currentTime);

    if (!entry || (!lockedOut && currentTime - entry.windowStart >= windowMs)) {
      entry = {
        windowStart: currentTime,
        count: 0,
        lockoutUntil: entry?.lockoutUntil || null,
      };
      state.set(key, entry);
    }

    entry.count += 1;
    if (entry.count >= maxFailures) {
      entry.lockoutUntil = currentTime + windowMs;
    }

    const blockState = getBlockState(key);
    return {
      blocked: Boolean(blockState),
      retryAfterSeconds: blockState ? blockState.retryAfterSeconds : 0,
      windowStart: entry.windowStart,
      count: entry.count,
      lockoutUntil: entry.lockoutUntil,
    };
  }

  function reset(key) {
    state.delete(key);
  }

  return { isBlocked, recordFailure, reset, getRetryAfterSeconds };
}

function isAdminKeyExpired(env, now = Date.now()) {
  const expiresAt = String(env.ADMIN_API_KEY_EXPIRES_AT || "").trim();
  const normalized = expiresAt.toLowerCase();

  if (!expiresAt || normalized === "never" || normalized === "none") {
    return false;
  }

  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  return timestamp <= now;
}

function getAdminSessionTtlSeconds(env) {
  const configuredTtl = Number.parseInt(String(env.ADMIN_SESSION_TTL_SECONDS || ""), 10);
  if (!Number.isFinite(configuredTtl)) {
    return DEFAULT_ADMIN_SESSION_TTL_SECONDS;
  }

  return Math.min(
    Math.max(configuredTtl, MIN_ADMIN_SESSION_TTL_SECONDS),
    MAX_ADMIN_SESSION_TTL_SECONDS
  );
}

export function base64UrlEncodeBytes(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlEncodeString(value) {
  return base64UrlEncodeBytes(new TextEncoder().encode(value));
}

export function base64UrlDecodeToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function base64UrlDecodeToString(value) {
  return new TextDecoder().decode(base64UrlDecodeToBytes(value));
}

export function timingSafeEqualString(left, right) {
  const leftBytes = new TextEncoder().encode(String(left || ""));
  const rightBytes = new TextEncoder().encode(String(right || ""));
  if (leftBytes.length !== rightBytes.length) return false;

  let mismatch = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    mismatch |= leftBytes[index] ^ rightBytes[index];
  }
  return mismatch === 0;
}

export async function signAdminSessionPayload(payload, env) {
  const secret = String(env.ADMIN_SESSION_SECRET || env.ADMIN_API_KEY || "").trim();
  if (!secret || !globalThis.crypto?.subtle) return "";

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export function getAdminSessionCookie(request) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const cookies = cookieHeader.split(";").map((cookie) => cookie.trim());
  const prefix = `${ADMIN_SESSION_COOKIE_NAME}=`;
  const cookie = cookies.find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : "";
}

function getAdminSessionCredential(request) {
  return getAdminSessionCookie(request);
}

export function getAdminSessionCookieSameSite(request, env) {
  const configured = String(env.ADMIN_SESSION_COOKIE_SAMESITE || "").trim().toLowerCase();
  if (configured === "none") return "None";
  if (configured === "strict") return "Strict";
  if (configured === "lax") return "Lax";

  const origin = request.headers.get("Origin") || "";
  const requestOrigin = new URL(request.url).origin;
  return origin && origin !== requestOrigin ? "None" : "Lax";
}

/**
 * Build the admin session cookie with the __Host- prefix. The __Host- prefix
 * requires Path=/ (and Secure, which is always set here), so the session cookie
 * is scoped to the whole worker origin. The cookie name is internal to the
 * worker — the dashboard never reads it by name.
 */
export function buildAdminSessionCookie(request, token, maxAgeSeconds, env) {
  return [
    `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    `SameSite=${getAdminSessionCookieSameSite(request, env)}`,
  ].join("; ");
}

export function buildExpiredAdminSessionCookie(request, env) {
  return buildAdminSessionCookie(request, "", 0, env);
}

export async function createAdminSessionToken(env, now = Date.now()) {
  const ttlSeconds = getAdminSessionTtlSeconds(env);
  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + ttlSeconds;
  const sessionId = globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `${issuedAt}-${Math.random().toString(36).slice(2)}`;
  const payload = {
    type: "admin_session",
    iat: issuedAt,
    exp: expiresAt,
    jti: sessionId,
    key: await fingerprintCredential(env.ADMIN_API_KEY || ""),
  };
  const encodedPayload = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await signAdminSessionPayload(encodedPayload, env);

  return {
    token: `${encodedPayload}.${signature}`,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    ttlSeconds,
    fingerprint: await fingerprintCredential(`session:${sessionId}`),
  };
}

export async function verifyAdminSessionToken(token, env, now = Date.now()) {
  const [encodedPayload, signature, extra] = String(token || "").split(".");
  const fingerprint = await fingerprintCredential(token);
  if (!encodedPayload || !signature || extra) {
    return { allowed: false, fingerprint };
  }

  const expectedSignature = await signAdminSessionPayload(encodedPayload, env);
  if (!expectedSignature || !timingSafeEqualString(signature, expectedSignature)) {
    return { allowed: false, fingerprint };
  }

  let payload;
  try {
    payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
  } catch (error) {
    return { allowed: false, fingerprint };
  }

  const nowSeconds = Math.floor(now / 1000);
  const expectedKeyFingerprint = await fingerprintCredential(env.ADMIN_API_KEY || "");
  const sessionFingerprint = await fingerprintCredential(`session:${payload.jti || token}`);
  if (
    payload.type !== "admin_session" ||
    !payload.exp ||
    payload.exp <= nowSeconds ||
    payload.key !== expectedKeyFingerprint ||
    isAdminKeyExpired(env, now)
  ) {
    return { allowed: false, fingerprint: sessionFingerprint };
  }

  return {
    allowed: true,
    fingerprint: sessionFingerprint,
  };
}

export function getAdminCredential(request) {
  const authorization = request.headers.get("Authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerToken = request.headers.get("X-Admin-Key") || "";

  return bearerToken || headerToken;
}

export async function fingerprintCredential(value) {
  const credential = String(value || "");
  if (!credential || !globalThis.crypto?.subtle) return "";

  const data = new TextEncoder().encode(credential);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function getAdminKeyAccess(credential, env, now = Date.now()) {
  const expectedKey = String(env.ADMIN_API_KEY || "").trim();
  const normalizedCredential = String(credential || "").trim();
  const fingerprint = await fingerprintCredential(normalizedCredential);
  if (!expectedKey) return { allowed: false, fingerprint, reason: "missing_admin_key" };
  if (isAdminKeyExpired(env, now)) return { allowed: false, fingerprint, reason: "admin_key_expired" };

  return {
    allowed: timingSafeEqualString(normalizedCredential, expectedKey),
    fingerprint,
    reason: timingSafeEqualString(normalizedCredential, expectedKey) ? "" : "invalid_admin_key",
  };
}

export async function getAdminAccess(request, env) {
  const sessionToken = getAdminSessionCredential(request);
  if (sessionToken) {
    const sessionAccess = await verifyAdminSessionToken(sessionToken, env);
    if (sessionAccess.allowed) return sessionAccess;
  }

  return getAdminKeyAccess(getAdminCredential(request), env);
}

/**
 * Sanitized 500 body: a generic message plus a correlation id for server-side
 * triage. Never echoes error.message (which can leak internals).
 */
export function buildSafeErrorResponse(error) {
  return {
    error: "Engagement service failed.",
    correlationId: globalThis.crypto?.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  };
}
