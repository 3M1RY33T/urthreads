/**
 * Cloudflare Worker for Threads
 * 
 * This worker handles POST likes and comments using Cloudflare D1 database.
 * It provides a lightweight engagement API for static websites.
 * 
 * Required bindings:
 * - DB: Cloudflare D1 database (must have schema from schema.sql)
 * 
 * Required environment variables:
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins (or "*" for all)
 * - ADMIN_API_KEY: Optional bearer key for protected admin endpoints
 * - ADMIN_API_KEY_EXPIRES_AT: Optional ISO timestamp for admin key expiry
 * - ADMIN_SESSION_TTL_SECONDS: Optional admin dashboard session TTL (default 3600)
 */

import {
  getCorsHeaders,
  isAdminMutation,
  checkCsrf,
  getClientIp,
  createAdminRateLimiter,
  createAdminSessionToken,
  buildAdminSessionCookie,
  buildExpiredAdminSessionCookie,
  getAdminKeyAccess,
  getAdminAccess,
  fingerprintCredential,
  buildSafeErrorResponse,
} from "./worker-security.mjs";

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const ADMIN_LOGIN_MAX_FAILURES = 5;
const ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;
const PUBLIC_RATE_LIMIT_LIKES = 30;
const PUBLIC_RATE_LIMIT_COMMENT_LIKES = 30;
const PUBLIC_RATE_LIMIT_COMMENTS = 5;
const PUBLIC_RATE_LIMIT_WINDOW_MS = 60_000;
let commentHiddenColumnReady = false;
let deniedKeywordsTableReady = false;
let authAttemptsTableReady = false;
let publicRateLimitsTableReady = false;
let adminSessionsTableReady = false;
const adminLoginLimiter = createAdminRateLimiter({
  maxFailures: ADMIN_LOGIN_MAX_FAILURES,
  windowMs: ADMIN_LOGIN_WINDOW_MS,
});



/**
 * Return JSON response with CORS headers
 */
function jsonResponse(request, env, body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...getCorsHeaders(request, env),
      ...extraHeaders,
    },
  });
}

/**
 * Normalize and validate post path
 */
function normalizePath(value) {
  const path = String(value || "").trim();

  if (!path.startsWith("/") || path.length > 500) {
    return "";
  }

  return path;
}

/**
 * Normalize text field with max length
 */
function normalizeText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : "";
}

/**
 * Normalize optional text field
 */
function normalizeOptionalText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length <= maxLength ? text : "";
}

/**
 * Normalize and validate a page URL — only http/https protocols allowed.
 * Returns the trimmed string or "" if invalid.
 */
function normalizePageUrl(value, maxLength) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length > maxLength) return "";
  let url;
  try {
    url = new URL(text);
  } catch {
    return "";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "";
  return text;
}

/**
 * Sanitize error objects for logging — never include message or stack.
 */
function sanitizeErrorForLog(error) {
  if (error instanceof Error) return error.name;
  return "UnknownError";
}

// --- Email encryption at rest (AES-GCM, opt-in via DATA_ENCRYPTION_KEY) -----

let cachedEncryptionKey = null;
let cachedKeyMaterial = null;

async function getEmailEncryptionKey(env) {
  const material = env?.DATA_ENCRYPTION_KEY;
  if (!material) return null;
  if (cachedKeyMaterial === material && cachedEncryptionKey) return cachedEncryptionKey;
  const encoder = new TextEncoder();
  cachedEncryptionKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(material),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  cachedKeyMaterial = material;
  return cachedEncryptionKey;
}

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBuf(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function encryptEmail(env, plaintext) {
  const key = await getEmailEncryptionKey(env);
  if (!key) return plaintext;
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return `enc:${bufToBase64(iv)}:${bufToBase64(ciphertext)}`;
}

async function decryptEmail(env, stored) {
  const text = String(stored || "");
  if (!text.startsWith("enc:")) return text;
  try {
    const key = await getEmailEncryptionKey(env);
    if (!key) return "";
    const parts = text.split(":"); // enc:<iv>:<ciphertext>
    if (parts.length < 3) return "";
    const iv = base64ToBuf(parts[1]);
    const ciphertext = base64ToBuf(parts.slice(2).join(":"));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      ciphertext
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return "";
  }
}

function normalizeDeniedKeyword(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, 80);
}

/**
 * Basic email validation
 */
function isValidEmail(value) {
  if (!value) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Format timestamp for display
 */
function formatTimestamp(value) {
  const timestamp = String(value || "");
  if (!timestamp) return "";
  return timestamp.includes("T") ? timestamp : `${timestamp.replace(" ", "T")}Z`;
}

function parsePositiveInteger(value, fallback, max) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) return fallback;
  return Math.min(number, max);
}

function parseStatsDays(value) {
  const range = String(value || "").trim().toLowerCase();
  const match = range.match(/^(\d+)d$/);
  const days = match ? Number(match[1]) : Number(value);
  if (!Number.isInteger(days) || days <= 0) return 30;
  return Math.min(days, 90);
}

function parseStatsStartDate(value) {
  const text = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;

  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    return null;
  }

  return date;
}

function normalizePathSearch(value) {
  return String(value || "").trim().slice(0, 500);
}

function escapeSqlLike(value) {
  return String(value || "").replace(/[\\%_]/g, (match) => `\\${match}`);
}

async function recordEngagementEvent(env, eventType, path, commentId = null) {
  if (!env.DB) return;

  try {
    await env.DB.prepare(`
      INSERT INTO engagement_events (event_type, path, comment_id)
      VALUES (?1, ?2, ?3)
    `)
      .bind(eventType, path, commentId)
      .run();
  } catch (error) {
    console.error("Unable to record engagement event: " + sanitizeErrorForLog(error));
  }
}

async function ensureCommentHiddenColumn(env) {
  if (!env.DB || commentHiddenColumnReady) return;

  try {
    await env.DB.prepare("ALTER TABLE post_comments ADD COLUMN hidden_at TEXT").run();
  } catch (error) {
    const message = String(error?.message || error || "").toLowerCase();
    if (!message.includes("duplicate column") && !message.includes("already exists")) {
      throw error;
    }
  }

  commentHiddenColumnReady = true;
}

async function ensureDeniedKeywordsTable(env) {
  if (!env.DB || deniedKeywordsTableReady) return;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS comment_denied_keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      keyword TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();

  deniedKeywordsTableReady = true;
}

async function ensureAuthAttemptsTable(env) {
  if (!env.DB || authAttemptsTableReady) return;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS auth_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      lockout_until INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bucket_key, window_start)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS auth_attempts_bucket_key_idx
      ON auth_attempts (bucket_key, window_start)
  `).run();

  authAttemptsTableReady = true;
}

async function getAuthAttemptsBlock(env, bucketKey) {
  if (!env.DB) return null;
  await ensureAuthAttemptsTable(env);

  const row = await env.DB.prepare(`
    SELECT window_start, attempt_count, lockout_until
    FROM auth_attempts
    WHERE bucket_key = ?1
    ORDER BY window_start DESC
    LIMIT 1
  `)
    .bind(bucketKey)
    .first();

  if (!row) return null;

  const nowMs = Date.now();
  const lockoutUntil = Number(row.lockout_until || 0);
  if (lockoutUntil > nowMs) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((lockoutUntil - nowMs) / 1000)),
    };
  }

  const windowStart = Number(row.window_start || 0);
  if (
    windowStart > 0 &&
    nowMs - windowStart < ADMIN_LOGIN_WINDOW_MS &&
    Number(row.attempt_count || 0) >= ADMIN_LOGIN_MAX_FAILURES
  ) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((windowStart + ADMIN_LOGIN_WINDOW_MS - nowMs) / 1000)),
    };
  }

  return null;
}

async function getAuthAttemptsWindowStart(env, bucketKey) {
  if (!env.DB) return Date.now();
  await ensureAuthAttemptsTable(env);

  const row = await env.DB.prepare(`
    SELECT window_start
    FROM auth_attempts
    WHERE bucket_key = ?1
    ORDER BY window_start DESC
    LIMIT 1
  `)
    .bind(bucketKey)
    .first();

  const nowMs = Date.now();
  const windowStart = Number(row?.window_start || 0);
  if (windowStart > 0 && nowMs - windowStart < ADMIN_LOGIN_WINDOW_MS) {
    return windowStart;
  }
  return nowMs;
}

async function recordAuthAttemptFailure(env, bucketKey, windowStartMs, lockoutUntilMs) {
  if (!env.DB) return;
  await ensureAuthAttemptsTable(env);

  await env.DB.prepare(`
    INSERT INTO auth_attempts (bucket_key, window_start, attempt_count, lockout_until, updated_at)
    VALUES (?1, ?2, 1, ?3, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key, window_start) DO UPDATE SET
      attempt_count = attempt_count + 1,
      lockout_until = ?3,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(bucketKey, windowStartMs, lockoutUntilMs)
    .run();
}

async function resetAuthAttempts(env, bucketKey) {
  if (!env.DB) return;
  await ensureAuthAttemptsTable(env);

  await env.DB.prepare("DELETE FROM auth_attempts WHERE bucket_key = ?1")
    .bind(bucketKey)
    .run();
}

async function ensurePublicRateLimitsTable(env) {
  if (!env.DB || publicRateLimitsTableReady) return;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS public_rate_limits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bucket_key TEXT NOT NULL,
      endpoint TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0,
      lockout_until INTEGER,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (bucket_key, endpoint, window_start)
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS public_rate_limits_bucket_idx
      ON public_rate_limits (bucket_key, endpoint, window_start)
  `).run();

  publicRateLimitsTableReady = true;
}

async function checkPublicRateLimit(env, ip, endpoint, maxRequests, windowMs) {
  if (!env.DB) return { allowed: true };
  await ensurePublicRateLimitsTable(env);

  const now = Date.now();
  const bucketKey = `${ip}:${endpoint}`;

  // Check for an active lockout first.
  const lockoutRow = await env.DB.prepare(`
    SELECT lockout_until
    FROM public_rate_limits
    WHERE bucket_key = ?1 AND endpoint = ?2 AND lockout_until IS NOT NULL
    ORDER BY lockout_until DESC
    LIMIT 1
  `)
    .bind(bucketKey, endpoint)
    .first();

  if (lockoutRow && Number(lockoutRow.lockout_until) > now) {
    const retryAfterSeconds = Math.max(1, Math.ceil((Number(lockoutRow.lockout_until) - now) / 1000));
    return { allowed: false, retryAfterSeconds };
  }

  // Find the current window row (most recent window_start within the window).
  const windowRow = await env.DB.prepare(`
    SELECT window_start, request_count
    FROM public_rate_limits
    WHERE bucket_key = ?1 AND endpoint = ?2
    ORDER BY window_start DESC
    LIMIT 1
  `)
    .bind(bucketKey, endpoint)
    .first();

  let windowStart;
  let currentCount;

  if (windowRow && Number(windowRow.window_start) > 0 && now - Number(windowRow.window_start) < windowMs) {
    windowStart = Number(windowRow.window_start);
    currentCount = Number(windowRow.request_count || 0);

    if (currentCount >= maxRequests) {
      // Lock out for the remaining window duration.
      const lockoutUntil = windowStart + windowMs;
      await env.DB.prepare(`
        INSERT INTO public_rate_limits (bucket_key, endpoint, window_start, request_count, lockout_until, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, CURRENT_TIMESTAMP)
        ON CONFLICT(bucket_key, endpoint, window_start) DO UPDATE SET
          lockout_until = ?5,
          updated_at = CURRENT_TIMESTAMP
      `)
        .bind(bucketKey, endpoint, windowStart, currentCount, lockoutUntil)
        .run();

      const retryAfterSeconds = Math.max(1, Math.ceil((lockoutUntil - now) / 1000));
      return { allowed: false, retryAfterSeconds };
    }
  } else {
    // Start a new window.
    windowStart = now;
    currentCount = 0;
  }

  // Increment the counter via upsert.
  await env.DB.prepare(`
    INSERT INTO public_rate_limits (bucket_key, endpoint, window_start, request_count, lockout_until, updated_at)
    VALUES (?1, ?2, ?3, 1, NULL, CURRENT_TIMESTAMP)
    ON CONFLICT(bucket_key, endpoint, window_start) DO UPDATE SET
      request_count = request_count + 1,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(bucketKey, endpoint, windowStart)
    .run();

  return { allowed: true };
}

async function ensureAdminSessionsTable(env) {
  if (!env.DB || adminSessionsTableReady) return;

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      jti TEXT PRIMARY KEY,
      issued_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await env.DB.prepare(`
    CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
      ON admin_sessions (expires_at)
  `).run();

  adminSessionsTableReady = true;
}

async function persistAdminSession(env, jti, issuedAt, expiresAt) {
  if (!env.DB) return;
  await ensureAdminSessionsTable(env);

  await env.DB.prepare(`
    INSERT INTO admin_sessions (jti, issued_at, expires_at)
    VALUES (?1, ?2, ?3)
    ON CONFLICT(jti) DO NOTHING
  `)
    .bind(jti, issuedAt, expiresAt)
    .run();
}

async function isAdminSessionValid(env, jti) {
  if (!env.DB) return true;
  await ensureAdminSessionsTable(env);

  const row = await env.DB.prepare(`
    SELECT revoked, expires_at
    FROM admin_sessions
    WHERE jti = ?1
  `)
    .bind(jti)
    .first();

  if (!row) return false;
  if (Number(row.revoked) === 1) return false;
  if (Number(row.expires_at) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

async function revokeAdminSession(env, jti) {
  if (!env.DB) return;
  await ensureAdminSessionsTable(env);

  await env.DB.prepare("UPDATE admin_sessions SET revoked = 1 WHERE jti = ?1")
    .bind(jti)
    .run();
}

async function pruneExpiredAdminSessions(env) {
  if (!env.DB) return;
  await ensureAdminSessionsTable(env);

  const nowSeconds = Math.floor(Date.now() / 1000);
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at < ?1")
    .bind(nowSeconds)
    .run();
}

async function validateAdminAccess(request, env) {
  const access = await getAdminAccess(request, env);
  if (access.allowed && access.jti) {
    const valid = await isAdminSessionValid(env, access.jti);
    if (!valid) {
      return { allowed: false, fingerprint: access.fingerprint };
    }
  }
  return access;
}

async function getLoginRetryAfterSeconds(env, ipBucketKey, credBucketKey) {
  // In-memory fast pre-filter (per-isolate), then the durable D1 boundary.
  if (adminLoginLimiter.isBlocked(ipBucketKey)) {
    return adminLoginLimiter.getRetryAfterSeconds(ipBucketKey);
  }

  const ipBlock = await getAuthAttemptsBlock(env, ipBucketKey);
  if (ipBlock) return ipBlock.retryAfterSeconds;

  const credBlock = await getAuthAttemptsBlock(env, credBucketKey);
  if (credBlock) return credBlock.retryAfterSeconds;

  return 0;
}

async function listDeniedKeywords(env) {
  if (!env.DB) return [];

  await ensureDeniedKeywordsTable(env);

  const { results } = await env.DB.prepare(`
    SELECT keyword
    FROM comment_denied_keywords
    ORDER BY keyword ASC
  `).all();

  return (results || []).map((row) => row.keyword).filter(Boolean);
}

async function replaceDeniedKeywords(env, keywords) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  await ensureDeniedKeywordsTable(env);

  const normalizedKeywords = Array.from(new Set(
    (Array.isArray(keywords) ? keywords : [])
      .map(normalizeDeniedKeyword)
      .filter((keyword) => keyword.length >= 2)
  )).slice(0, 100);

  const statements = [
    env.DB.prepare("DELETE FROM comment_denied_keywords"),
    ...normalizedKeywords.map((keyword) => env.DB.prepare(`
      INSERT INTO comment_denied_keywords (keyword)
      VALUES (?1)
    `).bind(keyword)),
  ];

  await env.DB.batch(statements);
  return normalizedKeywords;
}

async function getDeniedKeywordMatch(env, fields) {
  let keywords = [];
  try {
    keywords = await listDeniedKeywords(env);
  } catch (error) {
    console.error("Unable to load denied keywords: " + sanitizeErrorForLog(error));
    return "";
  }

  if (!keywords.length) return "";
  const haystack = fields
    .map((field) => String(field || "").toLowerCase())
    .join("\n");
  return keywords.find((keyword) => haystack.includes(keyword)) || "";
}





function getUserAgent(request) {
  return String(request.headers.get("User-Agent") || "").slice(0, 500);
}

function safeJsonDetails(details) {
  if (!details || typeof details !== "object") return "";
  try {
    return JSON.stringify(details).slice(0, 2000);
  } catch (error) {
    return "";
  }
}

function parseAuditDetails(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    return null;
  }
}

async function recordAdminAuditLog(env, request, url, event) {
  if (!env.DB) return;

  try {
    await env.DB.prepare(`
      INSERT INTO admin_audit_logs (
        action,
        method,
        path,
        status,
        admin_key_fingerprint,
        client_ip,
        user_agent,
        details
      )
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    `)
      .bind(
        event.action,
        request.method,
        `${url.pathname}${url.search}`,
        Number(event.status || 0),
        event.fingerprint || "",
        getClientIp(request),
        getUserAgent(request),
        safeJsonDetails(event.details)
      )
      .run();
  } catch (error) {
    console.error("Unable to record admin audit log: " + sanitizeErrorForLog(error));
  }
}

/**
 * Get current like count for a post
 */
async function getLikeCount(env, path) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const row = await env.DB.prepare(
    "SELECT count FROM post_likes WHERE path = ?1"
  )
    .bind(path)
    .first();

  return Number(row?.count || 0);
}

/**
 * Increment like count for a post
 */
async function incrementLikeCount(env, path) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  await env.DB.prepare(`
    INSERT INTO post_likes (path, count, updated_at)
    VALUES (?1, 1, CURRENT_TIMESTAMP)
    ON CONFLICT(path) DO UPDATE SET
      count = count + 1,
      updated_at = CURRENT_TIMESTAMP
  `)
    .bind(path)
    .run();

  await recordEngagementEvent(env, "page_like", path);

  return getLikeCount(env, path);
}

/**
 * Get approved comments for a post
 */
async function getApprovedComments(env, path) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const maxComments = parsePositiveInteger(env.MAX_COMMENTS_PER_POST, 100, 500);
  const { results } = await env.DB.prepare(`
    SELECT id, parent_id, author_name, content, created_at, likes_count, hidden_at
    FROM post_comments
    WHERE path = ?1
      AND status = 'approved'
    ORDER BY created_at ASC, id ASC
    LIMIT ?2
  `)
    .bind(path, maxComments)
    .all();

  const comments = (results || []).map((comment) => ({
    id: comment.id,
    parentId: comment.parent_id || null,
    authorName: comment.author_name,
    content: comment.content,
    likesCount: Number(comment.likes_count || 0),
    hiddenAt: comment.hidden_at || null,
    createdAt: formatTimestamp(comment.created_at),
    replies: [],
  }));

  const commentMap = new Map();
  const rootComments = [];

  comments.forEach((comment) => {
    commentMap.set(comment.id, comment);
  });

  comments.forEach((comment) => {
    if (comment.hiddenAt) {
      return;
    }
    if (comment.parentId && commentMap.has(comment.parentId)) {
      commentMap.get(comment.parentId).replies.push(comment);
    } else if (!comment.parentId) {
      rootComments.push(comment);
    }
  });

  return rootComments;
}

/**
 * Create a new comment (stored as pending)
 */
async function createComment(env, data) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const parentId = data.parentId ? Number(data.parentId) : null;
  const status = data.status === "rejected" ? "rejected" : "pending";

  if (parentId) {
    const parent = await env.DB.prepare(
      "SELECT id FROM post_comments WHERE id = ?1 AND path = ?2"
    )
      .bind(parentId, data.path)
      .first();

    if (!parent) {
      throw new Error("The parent comment does not exist for this post.");
    }
  }

  const result = await env.DB.prepare(`
    INSERT INTO post_comments (
      path,
      parent_id,
      page_url,
      page_title,
      author_name,
      author_email,
      author_website,
      content,
      status,
      created_at,
      updated_at
    )
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(
      data.path,
      parentId,
      data.pageUrl,
      data.pageTitle,
      data.nickname,
      data.email ? (await encryptEmail(env, data.email)) : null,
      data.website || null,
      data.content,
      status
    )
    .run();

  const id = result.meta?.last_row_id || null;
  await recordEngagementEvent(env, "comment_create", data.path, id);
  return id;
}

/**
 * Handle likes requests (GET to retrieve, POST to increment)
 */
async function handleLikes(request, env, url) {
  const path = normalizePath(url.searchParams.get("path"));

  if (!path) {
    return jsonResponse(
      request,
      env,
      { error: "A valid post path is required." },
      400
    );
  }

  if (request.method === "GET") {
    const count = await getLikeCount(env, path);
    return jsonResponse(request, env, { path, count });
  }

  if (request.method === "POST") {
    const ip = getClientIp(request);
    const rateLimit = await checkPublicRateLimit(env, ip, "likes", PUBLIC_RATE_LIMIT_LIKES, PUBLIC_RATE_LIMIT_WINDOW_MS);
    if (!rateLimit.allowed) {
      return jsonResponse(
        request,
        env,
        { error: "Rate limit exceeded. Try again later." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) }
      );
    }
    const count = await incrementLikeCount(env, path);
    return jsonResponse(request, env, { path, count });
  }

  return jsonResponse(request, env, { error: "Method not allowed." }, 405);
}

/**
 * Handle comments requests (GET to retrieve, POST to create)
 */
async function getCommentLikeCount(env, commentId) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const row = await env.DB.prepare(
    "SELECT likes_count FROM post_comments WHERE id = ?1"
  )
    .bind(commentId)
    .first();

  if (!row) {
    return null;
  }

  return Number(row.likes_count || 0);
}

async function incrementCommentLikeCount(env, commentId) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const result = await env.DB.prepare(`
    UPDATE post_comments
    SET likes_count = likes_count + 1,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?1
  `)
    .bind(commentId)
    .run();

  if (result?.meta?.affected_rows === 0) {
    return null;
  }

  const comment = await env.DB.prepare(
    "SELECT path FROM post_comments WHERE id = ?1"
  )
    .bind(commentId)
    .first();

  if (comment?.path) {
    await recordEngagementEvent(env, "comment_like", comment.path, commentId);
  }

  return getCommentLikeCount(env, commentId);
}

async function handleCommentLikes(request, env, url) {
  const commentId = Number(url.searchParams.get("commentId"));

  if (!commentId || Number.isNaN(commentId)) {
    return jsonResponse(
      request,
      env,
      { error: "A valid commentId is required." },
      400
    );
  }

  if (request.method === "GET") {
    const likes = await getCommentLikeCount(env, commentId);
    if (likes === null) {
      return jsonResponse(request, env, { error: "Comment not found." }, 404);
    }
    return jsonResponse(request, env, { commentId, likes });
  }

  if (request.method === "POST") {
    const ip = getClientIp(request);
    const rateLimit = await checkPublicRateLimit(env, ip, "comment_likes", PUBLIC_RATE_LIMIT_COMMENT_LIKES, PUBLIC_RATE_LIMIT_WINDOW_MS);
    if (!rateLimit.allowed) {
      return jsonResponse(
        request,
        env,
        { error: "Rate limit exceeded. Try again later." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) }
      );
    }
    const likes = await incrementCommentLikeCount(env, commentId);
    if (likes === null) {
      return jsonResponse(request, env, { error: "Comment not found." }, 404);
    }
    return jsonResponse(request, env, { commentId, likes });
  }

  return jsonResponse(request, env, { error: "Method not allowed." }, 405);
}

async function handleComments(request, env, url) {
  if (request.method === "GET") {
    const path = normalizePath(url.searchParams.get("path"));

    if (!path) {
      return jsonResponse(
        request,
        env,
        { error: "A valid post path is required." },
        400
      );
    }

    const comments = await getApprovedComments(env, path);
    return jsonResponse(request, env, { path, comments });
  }

  if (request.method === "POST") {
    const ip = getClientIp(request);
    const rateLimit = await checkPublicRateLimit(env, ip, "comments", PUBLIC_RATE_LIMIT_COMMENTS, PUBLIC_RATE_LIMIT_WINDOW_MS);
    if (!rateLimit.allowed) {
      return jsonResponse(
        request,
        env,
        { error: "Rate limit exceeded. Try again later." },
        429,
        { "Retry-After": String(rateLimit.retryAfterSeconds) }
      );
    }

    let payload;

    try {
      payload = await request.json();
    } catch (error) {
      return jsonResponse(
        request,
        env,
        { error: "Request body must be valid JSON." },
        400
      );
    }

    payload = payload && typeof payload === "object" ? payload : {};

    // Spam filter: reject if website field is filled (common bot pattern)
    if (String(payload.website || "").trim()) {
      return jsonResponse(request, env, { ok: true, status: "pending" }, 202);
    }

    const path = normalizePath(payload.path);
    const pageUrl = normalizePageUrl(payload.pageUrl, 1000);
    const pageTitle = normalizeText(payload.pageTitle, 300);
    const nickname = normalizeText(payload.nickname, 80);
    const email = normalizeOptionalText(payload.email, 254);
    const website = normalizeOptionalText(payload.website, 254);
    const content = normalizeText(payload.content, 2000);
    const parentId = payload.parentId ? Number(payload.parentId) : null;

    if (!path || !pageUrl || !pageTitle || !nickname || !content) {
      return jsonResponse(
        request,
        env,
        { error: "Comment is missing required fields." },
        400
      );
    }

    if (!isValidEmail(email)) {
      return jsonResponse(
        request,
        env,
        { error: "Email address is invalid." },
        400
      );
    }

    try {
      const deniedKeyword = await getDeniedKeywordMatch(env, [content, nickname]);
      const status = deniedKeyword ? "rejected" : "pending";
      const id = await createComment(env, {
        path,
        pageUrl,
        pageTitle,
        nickname,
        email,
        website,
        content,
        parentId,
        status,
      });

      return jsonResponse(
        request,
        env,
        { id, path, status: "pending", parentId },
        deniedKeyword ? 202 : 201
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (
        message === "The parent comment does not exist for this post." ||
        message === "D1 binding DB is not configured."
      ) {
        return jsonResponse(request, env, { error: message }, 400);
      }
      const safeBody = buildSafeErrorResponse(error);
      console.error(`Comment create error [${safeBody.correlationId}]: ${sanitizeErrorForLog(error)}`);
      return jsonResponse(request, env, safeBody, 500);
    }
  }

  return jsonResponse(request, env, { error: "Method not allowed." }, 405);
}

async function getAdminSummary(env) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const [likeSummary, commentSummary, commentLikeSummary, recentPending] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) as total_posts, COALESCE(SUM(count), 0) as total_likes
      FROM post_likes
    `).first(),
    env.DB.prepare(`
      SELECT
        COUNT(*) as total_comments,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_comments,
        SUM(CASE WHEN status = 'approved' AND hidden_at IS NULL THEN 1 ELSE 0 END) as approved_comments,
        SUM(CASE WHEN status = 'approved' AND hidden_at IS NOT NULL THEN 1 ELSE 0 END) as hidden_comments,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_comments
      FROM post_comments
    `).first(),
    env.DB.prepare(`
      SELECT COALESCE(SUM(likes_count), 0) as total_comment_likes
      FROM post_comments
    `).first(),
    env.DB.prepare(`
      SELECT id, path, author_name, content, created_at
      FROM post_comments
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC
      LIMIT 5
    `).all(),
  ]);

  return {
    likes: {
      totalPosts: Number(likeSummary?.total_posts || 0),
      totalLikes: Number(likeSummary?.total_likes || 0),
      totalCommentLikes: Number(commentLikeSummary?.total_comment_likes || 0),
    },
    comments: {
      total: Number(commentSummary?.total_comments || 0),
      pending: Number(commentSummary?.pending_comments || 0),
      approved: Number(commentSummary?.approved_comments || 0),
      hidden: Number(commentSummary?.hidden_comments || 0),
      rejected: Number(commentSummary?.rejected_comments || 0),
    },
    recentPending: (recentPending.results || []).map((comment) => ({
      id: comment.id,
      path: comment.path,
      authorName: comment.author_name,
      content: comment.content,
      createdAt: formatTimestamp(comment.created_at),
    })),
  };
}

async function listAdminComments(env, url) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const allowedStatuses = new Set(["pending", "approved", "rejected", "hidden", "all"]);
  const status = allowedStatuses.has(url.searchParams.get("status"))
    ? url.searchParams.get("status")
    : "pending";
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 100);
  const pathFilter = normalizePath(url.searchParams.get("path"));

  const whereParts = [];
  const bindings = [];

  if (status === "hidden") {
    whereParts.push("hidden_at IS NOT NULL");
  } else if (status === "approved") {
    whereParts.push("status = ?");
    bindings.push(status);
    whereParts.push("hidden_at IS NULL");
  } else if (status !== "all") {
    whereParts.push("status = ?");
    bindings.push(status);
  }

  if (pathFilter) {
    whereParts.push("path = ?");
    bindings.push(pathFilter);
  }

  const whereClause = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";
  const statement = env.DB.prepare(`
    WITH RECURSIVE
    matched_comments AS (
      SELECT id
      FROM post_comments
      ${whereClause}
      ORDER BY created_at DESC, id DESC
      LIMIT ?
    ),
    ancestor_comments AS (
      SELECT c.id, c.parent_id
      FROM post_comments c
      INNER JOIN matched_comments m ON m.id = c.id
      UNION
      SELECT parent.id, parent.parent_id
      FROM post_comments parent
      INNER JOIN ancestor_comments child ON child.parent_id = parent.id
    ),
    thread_roots AS (
      SELECT id
      FROM ancestor_comments
      WHERE parent_id IS NULL
    ),
    thread_comments AS (
      SELECT c.id, c.parent_id
      FROM post_comments c
      INNER JOIN thread_roots r ON r.id = c.id
      UNION
      SELECT child.id, child.parent_id
      FROM post_comments child
      INNER JOIN thread_comments parent ON child.parent_id = parent.id
    )
    SELECT
      c.id,
      c.path,
      c.parent_id,
      c.page_url,
      c.page_title,
      c.author_name,
      c.author_email,
      c.content,
      c.likes_count,
      c.status,
      c.hidden_at,
      c.created_at,
      c.updated_at,
      parent.author_name as parent_author_name,
      parent.content as parent_content
    FROM post_comments c
    LEFT JOIN post_comments parent ON parent.id = c.parent_id
    WHERE c.id IN (
      SELECT id FROM thread_comments
      UNION
      SELECT id FROM matched_comments
    )
    ORDER BY c.created_at DESC, c.id DESC
  `);

  const { results } = await statement.bind(...bindings, limit).all();

  const comments = [];
  for (const comment of (results || [])) {
    comments.push({
      id: comment.id,
      path: comment.path,
      parentId: comment.parent_id || null,
      parentAuthorName: comment.parent_author_name || "",
      parentContent: comment.parent_content || "",
      pageUrl: comment.page_url,
      pageTitle: comment.page_title,
      authorName: comment.author_name,
      authorEmail: await decryptEmail(env, comment.author_email || ""),
      content: comment.content,
      likesCount: Number(comment.likes_count || 0),
      status: comment.status,
      hiddenAt: formatTimestamp(comment.hidden_at),
      createdAt: formatTimestamp(comment.created_at),
      updatedAt: formatTimestamp(comment.updated_at),
    });
  }
  return comments;
}

async function updateCommentStatus(env, id, status) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return null;
  }

  const result = await env.DB.prepare(`
    UPDATE post_comments
    SET status = ?1,
        hidden_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?2
  `)
    .bind(status, commentId)
    .run();

  if (result?.meta?.affected_rows === 0) return null;

  return env.DB.prepare(`
    SELECT id, path, author_name, status, updated_at
    FROM post_comments
    WHERE id = ?1
  `)
    .bind(commentId)
    .first();
}

async function hideComment(env, id) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return null;
  }

  const result = await env.DB.prepare(`
    UPDATE post_comments
    SET status = 'approved',
        hidden_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?1
  `)
    .bind(commentId)
    .run();

  if (result?.meta?.affected_rows === 0) return null;

  return env.DB.prepare(`
    SELECT id, path, author_name, status, hidden_at, updated_at
    FROM post_comments
    WHERE id = ?1
  `)
    .bind(commentId)
    .first();
}

async function unhideComment(env, id) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }
  await ensureCommentHiddenColumn(env);

  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return null;
  }

  const result = await env.DB.prepare(`
    UPDATE post_comments
    SET status = 'approved',
        hidden_at = NULL,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?1
  `)
    .bind(commentId)
    .run();

  if (result?.meta?.affected_rows === 0) return null;

  return env.DB.prepare(`
    SELECT id, path, author_name, status, hidden_at, updated_at
    FROM post_comments
    WHERE id = ?1
  `)
    .bind(commentId)
    .first();
}

async function deleteComment(env, id) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return null;
  }

  const comment = await env.DB.prepare(`
    SELECT id, path, author_name
    FROM post_comments
    WHERE id = ?1
  `)
    .bind(commentId)
    .first();

  if (!comment) return null;

  const result = await env.DB.prepare(`
    WITH RECURSIVE comment_tree(id) AS (
      SELECT id FROM post_comments WHERE id = ?1
      UNION ALL
      SELECT child.id
      FROM post_comments child
      INNER JOIN comment_tree parent ON child.parent_id = parent.id
    )
    DELETE FROM post_comments
    WHERE id IN (SELECT id FROM comment_tree)
  `)
    .bind(commentId)
    .run();

  return {
    ...comment,
    deletedCount: Number(result?.meta?.changes || result?.meta?.rows_written || 0),
  };
}

async function listAdminLikes(env, url) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const limit = parsePositiveInteger(url.searchParams.get("limit"), 25, 100);
  const allowedSorts = new Set(["relevance", "likes", "commentLikes", "comments", "recent"]);
  const sort = allowedSorts.has(url.searchParams.get("sort"))
    ? url.searchParams.get("sort")
    : "relevance";
  const direction = url.searchParams.get("direction") === "asc" ? "ASC" : "DESC";
  const pathSearch = normalizePathSearch(url.searchParams.get("path"));
  const bindings = [];

  const sortExpressions = {
    relevance: "relevance_score",
    likes: "like_count",
    commentLikes: "comment_like_count",
    comments: "comment_count",
    recent: "last_activity_at",
  };
  const whereClause = pathSearch ? "WHERE p.path LIKE ? ESCAPE '\\'" : "";

  if (pathSearch) {
    bindings.push(`%${escapeSqlLike(pathSearch)}%`);
  }
  bindings.push(limit);

  const { results } = await env.DB.prepare(`
    WITH paths AS (
      SELECT path FROM post_likes
      UNION
      SELECT path FROM post_comments
    ),
    comment_counts AS (
      SELECT
        path,
        COUNT(*) as comment_count,
        COALESCE(SUM(likes_count), 0) as comment_like_count,
        MAX(updated_at) as last_comment_at
      FROM post_comments
      GROUP BY path
    )
    SELECT
      p.path,
      COALESCE(l.count, 0) as like_count,
      COALESCE(c.comment_count, 0) as comment_count,
      COALESCE(c.comment_like_count, 0) as comment_like_count,
      (COALESCE(l.count, 0) + COALESCE(c.comment_like_count, 0) + (COALESCE(c.comment_count, 0) * 1.5)) as relevance_score,
      CASE
        WHEN l.updated_at IS NULL THEN c.last_comment_at
        WHEN c.last_comment_at IS NULL THEN l.updated_at
        WHEN l.updated_at >= c.last_comment_at THEN l.updated_at
        ELSE c.last_comment_at
      END as last_activity_at
    FROM paths p
    LEFT JOIN post_likes l ON l.path = p.path
    LEFT JOIN comment_counts c ON c.path = p.path
    ${whereClause}
    ORDER BY ${sortExpressions[sort]} ${direction}, p.path ASC
    LIMIT ?
  `)
    .bind(...bindings)
    .all();

  return (results || []).map((like) => ({
    path: like.path,
    count: Number(like.like_count || 0),
    commentLikeCount: Number(like.comment_like_count || 0),
    commentCount: Number(like.comment_count || 0),
    relevanceScore: Number(like.relevance_score || 0),
    updatedAt: formatTimestamp(like.last_activity_at),
  }));
}

async function getAdminStats(env, url) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const days = parseStatsDays(url.searchParams.get("range") || url.searchParams.get("days"));
  const now = new Date();
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const requestedStart = parseStatsStartDate(url.searchParams.get("start"));
  const isHourly = days === 1;
  const latestStart = new Date(today);
  latestStart.setUTCDate(latestStart.getUTCDate() - (days - 1));
  const since = requestedStart ? new Date(requestedStart) : new Date(now);
  if (requestedStart) {
    if (since > latestStart) {
      since.setTime(latestStart.getTime());
    }
  } else if (isHourly) {
    since.setTime(today.getTime());
  } else {
    since.setUTCDate(since.getUTCDate() - (days - 1));
    since.setUTCHours(0, 0, 0, 0);
  }
  const until = new Date(since);
  if (isHourly) {
    until.setUTCDate(until.getUTCDate() + 1);
  } else {
    until.setUTCDate(until.getUTCDate() + days);
  }
  const sinceTimestamp = since.toISOString();
  const sinceSqlTimestamp = sinceTimestamp.slice(0, 19).replace("T", " ");
  const untilTimestamp = until.toISOString();
  const untilSqlTimestamp = untilTimestamp.slice(0, 19).replace("T", " ");
  const sinceDate = sinceTimestamp.slice(0, 10);
  const untilDate = untilTimestamp.slice(0, 10);
  const bucketExpression = isHourly
    ? "strftime('%Y-%m-%dT%H:00:00Z', created_at)"
    : "date(created_at)";
  const updatedBucketExpression = isHourly
    ? "strftime('%Y-%m-%dT%H:00:00Z', updated_at)"
    : "date(updated_at)";
  const timeFilter = isHourly
    ? "datetime(created_at) >= datetime(?1) AND datetime(created_at) < datetime(?2)"
    : "date(created_at) >= ?1 AND date(created_at) < ?2";
  const updatedTimeFilter = isHourly
    ? "datetime(updated_at) >= datetime(?1) AND datetime(updated_at) < datetime(?2)"
    : "date(updated_at) >= ?1 AND date(updated_at) < ?2";
  const sinceBinding = isHourly ? sinceSqlTimestamp : sinceDate;
  const untilBinding = isHourly ? untilSqlTimestamp : untilDate;

  const events = await env.DB.prepare(`
    SELECT
      ${bucketExpression} as bucket,
      event_type,
      COUNT(*) as count
    FROM engagement_events
    WHERE ${timeFilter}
    GROUP BY bucket, event_type
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const legacyPageLikes = await env.DB.prepare(`
    SELECT
      ${updatedBucketExpression} as bucket,
      COALESCE(SUM(count), 0) as count
    FROM post_likes
    WHERE ${updatedTimeFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const legacyCommentLikes = await env.DB.prepare(`
    SELECT
      ${updatedBucketExpression} as bucket,
      COALESCE(SUM(likes_count), 0) as count
    FROM post_comments
    WHERE ${updatedTimeFilter}
      AND likes_count > 0
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const legacyComments = await env.DB.prepare(`
    SELECT
      ${bucketExpression} as bucket,
      COUNT(*) as count
    FROM post_comments
    WHERE ${timeFilter}
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const moderation = await env.DB.prepare(`
    SELECT
      ${bucketExpression} as bucket,
      COUNT(*) as count
    FROM admin_audit_logs
    WHERE ${timeFilter}
      AND action IN ('admin.comments.approve', 'admin.comments.reject', 'admin.comments.hide', 'admin.comments.unhide', 'admin.comments.delete')
      AND status < 400
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const legacyModeration = await env.DB.prepare(`
    SELECT
      ${updatedBucketExpression} as bucket,
      COUNT(*) as count
    FROM post_comments
    WHERE ${updatedTimeFilter}
      AND status IN ('approved', 'rejected')
    GROUP BY bucket
    ORDER BY bucket ASC
  `)
    .bind(sinceBinding, untilBinding)
    .all();

  const buckets = new Map();
  const bucketCount = isHourly ? 24 : days;
  for (let index = 0; index < bucketCount; index += 1) {
    const bucketDate = new Date(since);
    if (isHourly) {
      bucketDate.setUTCHours(index, 0, 0, 0);
    } else {
      bucketDate.setUTCDate(since.getUTCDate() + index);
    }
    const key = isHourly ? bucketDate.toISOString().slice(0, 13) + ":00:00Z" : bucketDate.toISOString().slice(0, 10);
    buckets.set(key, {
      bucket: key,
      day: key.slice(0, 10),
      pageLikes: 0,
      commentLikes: 0,
      comments: 0,
      moderationActions: 0,
    });
  }

  const eventRows = events.results || [];
  const hasEventType = (eventType) => eventRows.some((row) => row.event_type === eventType);
  const applyRows = (rows, key) => {
    (rows.results || rows || []).forEach((row) => {
      const bucket = buckets.get(row.bucket);
      if (!bucket) return;
      bucket[key] = Number(row.count || 0);
    });
  };

  eventRows.forEach((row) => {
    const bucket = buckets.get(row.bucket);
    if (!bucket) return;
    const count = Number(row.count || 0);
    if (row.event_type === "page_like") bucket.pageLikes = count;
    if (row.event_type === "comment_like") bucket.commentLikes = count;
    if (row.event_type === "comment_create") bucket.comments = count;
  });

  if (!hasEventType("page_like")) applyRows(legacyPageLikes, "pageLikes");
  if (!hasEventType("comment_like")) applyRows(legacyCommentLikes, "commentLikes");
  if (!hasEventType("comment_create")) applyRows(legacyComments, "comments");

  if ((moderation.results || []).length) {
    applyRows(moderation, "moderationActions");
  } else {
    applyRows(legacyModeration, "moderationActions");
  }

  return {
    rangeDays: days,
    bucketUnit: isHourly ? "hour" : "day",
    since: sinceDate,
    sinceTimestamp,
    until: untilDate,
    untilTimestamp,
    selectedStart: sinceDate,
    includesLegacyAggregates: true,
    points: Array.from(buckets.values()),
  };
}

async function listAdminAuditLogs(env, url) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 100);
  const action = String(url.searchParams.get("action") || "").trim().slice(0, 120);
  const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
  const method = String(url.searchParams.get("method") || "").trim().toUpperCase();
  const pathSearch = normalizePathSearch(url.searchParams.get("path"));
  const date = parseStatsStartDate(url.searchParams.get("date"));
  const bindings = [];
  const filters = [];

  if (action) {
    bindings.push(action);
    filters.push(`action = ?${bindings.length}`);
  }

  if (allowedMethods.has(method)) {
    bindings.push(method);
    filters.push(`method = ?${bindings.length}`);
  }

  if (pathSearch) {
    bindings.push(`%${escapeSqlLike(pathSearch)}%`);
    filters.push(`path LIKE ?${bindings.length} ESCAPE '\\'`);
  }

  if (date) {
    bindings.push(date.toISOString().slice(0, 10));
    filters.push(`date(created_at) = ?${bindings.length}`);
  }

  bindings.push(limit);
  const limitPlaceholder = `?${bindings.length}`;
  const whereClause = filters.length ? `WHERE ${filters.join(" AND ")}` : "";

  const { results } = await env.DB.prepare(`
    SELECT
      id,
      action,
      method,
      path,
      status,
      admin_key_fingerprint,
      client_ip,
      user_agent,
      details,
      created_at
    FROM admin_audit_logs
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limitPlaceholder}
  `)
    .bind(...bindings)
    .all();

  return (results || []).map((log) => ({
    id: log.id,
    action: log.action,
    method: log.method,
    path: log.path,
    status: Number(log.status || 0),
    adminKeyFingerprint: log.admin_key_fingerprint || "",
    clientIp: log.client_ip || "",
    userAgent: log.user_agent || "",
    details: parseAuditDetails(log.details),
    createdAt: formatTimestamp(log.created_at),
  }));
}

async function readJsonBody(request) {
  try {
    const payload = await request.json();
    return payload && typeof payload === "object" ? payload : {};
  } catch (error) {
    return null;
  }
}

async function handleAdminSession(request, env, url) {
  if (url.pathname !== "/admin/session") {
    return jsonResponse(request, env, { error: "Not found." }, 404);
  }

  if (request.method === "POST") {
    const csrf = checkCsrf(request, env);
    if (!csrf.allowed) {
      return jsonResponse(request, env, { error: "Cross-origin request blocked." }, 403);
    }

    const payload = await readJsonBody(request);
    if (!payload) {
      const response = jsonResponse(request, env, { error: "Request body must be valid JSON." }, 400);
      await recordAdminAuditLog(env, request, url, {
        action: "admin.session.create_failed",
        status: response.status,
        details: { reason: "invalid_json" },
      });
      return response;
    }

    const credential = String(payload.adminKey || payload.key || "").trim();
    const credentialFingerprint = await fingerprintCredential(credential);
    const ipBucketKey = `ip:${getClientIp(request)}`;
    const credBucketKey = `cred:${credentialFingerprint}`;

    // Check order is load-bearing: Origin -> rate limit -> credential
    // validation. If credentials were checked first, login-CSRF from a victim's
    // browser could burn the victim's failed-attempt counter and lock them out.
    const retryAfterSeconds = await getLoginRetryAfterSeconds(env, ipBucketKey, credBucketKey);
    if (retryAfterSeconds > 0) {
      const response = jsonResponse(
        request,
        env,
        { error: "Too many failed login attempts. Try again later." },
        429,
        { "Retry-After": String(retryAfterSeconds) }
      );
      await recordAdminAuditLog(env, request, url, {
        action: "admin.session.rate_limited",
        status: response.status,
        fingerprint: credentialFingerprint,
        details: { retryAfterSeconds },
      });
      return response;
    }

    const access = await getAdminKeyAccess(credential, env);
    if (!access.allowed) {
      // Count the failure on both the in-memory fast pre-filter and the durable
      // D1 boundary, for the IP bucket and the credential-fingerprint bucket.
      const memoryResult = adminLoginLimiter.recordFailure(ipBucketKey);
      await recordAuthAttemptFailure(
        env,
        ipBucketKey,
        await getAuthAttemptsWindowStart(env, ipBucketKey),
        memoryResult.lockoutUntil || null
      );
      await recordAuthAttemptFailure(
        env,
        credBucketKey,
        await getAuthAttemptsWindowStart(env, credBucketKey),
        memoryResult.lockoutUntil || null
      );

      const response = jsonResponse(request, env, {
        error: "Admin access is required.",
        reason: access.reason || "invalid_admin_key",
      }, 401);
      await recordAdminAuditLog(env, request, url, {
        action: "admin.session.create_failed",
        status: response.status,
        fingerprint: access.fingerprint,
        details: { reason: access.reason || "invalid_admin_key" },
      });
      return response;
    }

    // Successful login resets the counters for this client.
    adminLoginLimiter.reset(ipBucketKey);
    await resetAuthAttempts(env, ipBucketKey);
    await resetAuthAttempts(env, credBucketKey);

    const session = await createAdminSessionToken(env);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + session.ttlSeconds;
    await persistAdminSession(env, session.jti, issuedAt, expiresAt);
    await pruneExpiredAdminSessions(env);
    const body = {
      authenticated: true,
      expiresAt: session.expiresAt,
      ttlSeconds: session.ttlSeconds,
    };

    const response = jsonResponse(
      request,
      env,
      body,
      200,
      {
        "Set-Cookie": buildAdminSessionCookie(request, session.token, session.ttlSeconds, env),
      }
    );
    await recordAdminAuditLog(env, request, url, {
      action: "admin.session.create",
      status: response.status,
      fingerprint: session.fingerprint,
    });
    return response;
  }

  if (request.method === "DELETE") {
    const csrf = checkCsrf(request, env);
    if (!csrf.allowed) {
      return jsonResponse(request, env, { error: "Cross-origin request blocked." }, 403);
    }

    const access = await validateAdminAccess(request, env);
    if (access.allowed && access.jti) {
      await revokeAdminSession(env, access.jti);
    }
    const response = jsonResponse(
      request,
      env,
      { authenticated: false },
      200,
      {
        "Set-Cookie": buildExpiredAdminSessionCookie(request, env),
      }
    );
    await recordAdminAuditLog(env, request, url, {
      action: "admin.session.delete",
      status: response.status,
      fingerprint: access.fingerprint,
    });
    return response;
  }

  if (request.method === "GET") {
    const access = await validateAdminAccess(request, env);
    const response = jsonResponse(
      request,
      env,
      { authenticated: access.allowed },
      access.allowed ? 200 : 401
    );
    await recordAdminAuditLog(env, request, url, {
      action: access.allowed ? "admin.session.read" : "admin.auth_failed",
      status: response.status,
      fingerprint: access.fingerprint,
    });
    return response;
  }

  return jsonResponse(request, env, { error: "Method not allowed." }, 405);
}

async function handleAdmin(request, env, url) {
  if (isAdminMutation(request, url)) {
    const csrf = checkCsrf(request, env);
    if (!csrf.allowed) {
      return jsonResponse(request, env, { error: "Cross-origin request blocked." }, 403);
    }
  }

  const access = await validateAdminAccess(request, env);
  if (!access.allowed) {
    const response = jsonResponse(request, env, { error: "Admin access is required." }, 401);
    await recordAdminAuditLog(env, request, url, {
      action: "admin.auth_failed",
      status: response.status,
      fingerprint: access.fingerprint,
    });
    return response;
  }

  let auditAction = "admin.not_found";
  let auditDetails = {};
  let response;

  if (url.pathname === "/admin/summary" && request.method === "GET") {
    const summary = await getAdminSummary(env);
    auditAction = "admin.summary.read";
    response = jsonResponse(request, env, summary);
  } else if (url.pathname === "/admin/stats" && request.method === "GET") {
    const stats = await getAdminStats(env, url);
    auditAction = "admin.stats.read";
    auditDetails = {
      range: url.searchParams.get("range") || url.searchParams.get("days") || "30d",
    };
    response = jsonResponse(request, env, stats);
  } else if (url.pathname === "/admin/comments" && request.method === "GET") {
    const comments = await listAdminComments(env, url);
    auditAction = "admin.comments.list";
    auditDetails = {
      status: url.searchParams.get("status") || "pending",
      limit: url.searchParams.get("limit") || "50",
      path: normalizePath(url.searchParams.get("path")) || "",
    };
    response = jsonResponse(request, env, { comments });
  } else if (
    (url.pathname === "/admin/comments/approve" ||
      url.pathname === "/admin/comments/reject" ||
      url.pathname === "/admin/comments/hide" ||
      url.pathname === "/admin/comments/unhide" ||
      url.pathname === "/admin/comments/delete") &&
    request.method === "POST"
  ) {
    const payload = await readJsonBody(request);
    if (!payload) {
      auditAction = "admin.comments.update_failed";
      auditDetails = { reason: "invalid_json" };
      response = jsonResponse(request, env, { error: "Request body must be valid JSON." }, 400);
    } else if (url.pathname.endsWith("/delete")) {
      const comment = await deleteComment(env, payload.id);
      auditAction = "admin.comments.delete";
      auditDetails = {
        commentId: Number(payload.id || 0),
        path: comment?.path || "",
        deletedCount: Number(comment?.deletedCount || 0),
      };
      if (!comment) {
        response = jsonResponse(request, env, { error: "Comment not found." }, 404);
      } else {
        response = jsonResponse(request, env, {
          id: comment.id,
          path: comment.path,
          authorName: comment.author_name,
          deletedCount: comment.deletedCount,
        });
      }
    } else if (url.pathname.endsWith("/hide")) {
      const comment = await hideComment(env, payload.id);
      auditAction = "admin.comments.hide";
      auditDetails = {
        commentId: Number(payload.id || 0),
        status: "hidden",
        path: comment?.path || "",
      };
      if (!comment) {
        response = jsonResponse(request, env, { error: "Comment not found." }, 404);
      } else {
        response = jsonResponse(request, env, {
          id: comment.id,
          path: comment.path,
          authorName: comment.author_name,
          status: "hidden",
          hiddenAt: formatTimestamp(comment.hidden_at),
          updatedAt: formatTimestamp(comment.updated_at),
        });
      }
    } else if (url.pathname.endsWith("/unhide")) {
      const comment = await unhideComment(env, payload.id);
      auditAction = "admin.comments.unhide";
      auditDetails = {
        commentId: Number(payload.id || 0),
        status: "approved",
        path: comment?.path || "",
      };
      if (!comment) {
        response = jsonResponse(request, env, { error: "Comment not found." }, 404);
      } else {
        response = jsonResponse(request, env, {
          id: comment.id,
          path: comment.path,
          authorName: comment.author_name,
          status: comment.status,
          hiddenAt: formatTimestamp(comment.hidden_at),
          updatedAt: formatTimestamp(comment.updated_at),
        });
      }
    } else {
      const status = url.pathname.endsWith("/approve") ? "approved" : "rejected";
      const comment = await updateCommentStatus(env, payload.id, status);
      auditAction = status === "approved"
        ? "admin.comments.approve"
        : "admin.comments.reject";
      auditDetails = {
        commentId: Number(payload.id || 0),
        status,
        path: comment?.path || "",
      };
      if (!comment) {
        response = jsonResponse(request, env, { error: "Comment not found." }, 404);
      } else {
        response = jsonResponse(request, env, {
          id: comment.id,
          path: comment.path,
          authorName: comment.author_name,
          status: comment.status,
          updatedAt: formatTimestamp(comment.updated_at),
        });
      }
    }
  } else if (url.pathname === "/admin/likes" && request.method === "GET") {
    const likes = await listAdminLikes(env, url);
    auditAction = "admin.likes.list";
    auditDetails = {
      sort: url.searchParams.get("sort") || "relevance",
      direction: url.searchParams.get("direction") || "desc",
      limit: url.searchParams.get("limit") || "25",
      path: normalizePathSearch(url.searchParams.get("path")),
    };
    response = jsonResponse(request, env, { likes });
  } else if (url.pathname === "/admin/comment-settings" && request.method === "GET") {
    const deniedKeywords = await listDeniedKeywords(env);
    auditAction = "admin.comment_settings.read";
    response = jsonResponse(request, env, { deniedKeywords });
  } else if (
    url.pathname === "/admin/comment-settings" &&
    (request.method === "POST" || request.method === "PUT")
  ) {
    const payload = await readJsonBody(request);
    if (!payload) {
      auditAction = "admin.comment_settings.update_failed";
      auditDetails = { reason: "invalid_json" };
      response = jsonResponse(request, env, { error: "Request body must be valid JSON." }, 400);
    } else {
      const deniedKeywords = await replaceDeniedKeywords(env, payload.deniedKeywords);
      auditAction = "admin.comment_settings.update";
      auditDetails = { deniedKeywordCount: deniedKeywords.length };
      response = jsonResponse(request, env, { deniedKeywords });
    }
  } else if (url.pathname === "/admin/audit-logs" && request.method === "GET") {
    const auditLogs = await listAdminAuditLogs(env, url);
    auditAction = "admin.audit_logs.list";
    auditDetails = {
      limit: url.searchParams.get("limit") || "50",
      action: String(url.searchParams.get("action") || "").slice(0, 120),
      method: String(url.searchParams.get("method") || "").slice(0, 12),
      path: normalizePathSearch(url.searchParams.get("path")),
      date: String(url.searchParams.get("date") || "").slice(0, 10),
    };
    response = jsonResponse(request, env, { auditLogs });
  } else if (url.pathname === "/admin/worker" && request.method === "GET") {
    const inferredWorkerName = url.hostname.endsWith(".workers.dev")
      ? url.hostname.split(".")[0]
      : "";

    auditAction = "admin.worker.read";
    response = jsonResponse(request, env, {
      workerUrl: url.origin,
      workerName: env.WORKER_NAME || inferredWorkerName,
      databaseName: env.D1_DATABASE_NAME || "",
      adminKeyExpiresAt: String(env.ADMIN_API_KEY_EXPIRES_AT || "").trim(),
      allowedOrigins: String(env.ALLOWED_ORIGINS || "")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
    });
  } else {
    response = jsonResponse(request, env, { error: "Not found." }, 404);
  }

  await recordAdminAuditLog(env, request, url, {
    action: auditAction,
    status: response.status,
    fingerprint: access.fingerprint,
    details: auditDetails,
  });
  return response;
}

/**
 * Main worker handler
 */
export {
  normalizePageUrl,
  sanitizeErrorForLog,
  getEmailEncryptionKey,
  encryptEmail,
  decryptEmail,
};

export default {
  async fetch(request, env) {
    try {
      // Handle CORS preflight
      if (request.method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: getCorsHeaders(request, env),
        });
      }

      const url = new URL(request.url);

      if (url.pathname === "/admin/session") {
        return await handleAdminSession(request, env, url);
      }

      if (url.pathname.startsWith("/admin/")) {
        return await handleAdmin(request, env, url);
      }

      // Route to appropriate handler
      if (url.pathname === "/likes") {
        return await handleLikes(request, env, url);
      }

      if (url.pathname === "/comments/like") {
        return await handleCommentLikes(request, env, url);
      }

      if (url.pathname === "/comments") {
        return await handleComments(request, env, url);
      }

      return jsonResponse(request, env, { error: "Not found." }, 404);
    } catch (error) {
      const safeBody = buildSafeErrorResponse(error);
      console.error(`Worker error [${safeBody.correlationId}]: ${sanitizeErrorForLog(error)}`);
      const response = jsonResponse(request, env, safeBody, 500);

      // A throw inside handleAdmin currently skips recordAdminAuditLog, so the
      // admin dispatch is wrapped here so 500s still hit the audit trail.
      let url;
      try {
        url = new URL(request.url);
      } catch (urlError) {
        url = null;
      }
      if (url && (url.pathname === "/admin/session" || url.pathname.startsWith("/admin/"))) {
        await recordAdminAuditLog(env, request, url, {
          action: "admin.error",
          status: response.status,
          details: { correlationId: safeBody.correlationId },
        });
      }

      return response;
    }
  },
};
