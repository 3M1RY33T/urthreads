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
 */

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

const MAX_COMMENTS_PER_POST = 100;

/**
 * Get CORS headers based on origin
 */
function getCorsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";

  const allowedOrigins = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (
    allowedOrigins.includes("*") ||
    allowedOrigins.includes(origin)
  ) {
    return {
      "Access-Control-Allow-Origin": allowedOrigins.includes("*")
        ? "*"
        : origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, X-Admin-Key",
      "Vary": "Origin",
    };
  }

  return {
    "Vary": "Origin",
  };
}

/**
 * Return JSON response with CORS headers
 */
function jsonResponse(request, env, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...jsonHeaders,
      ...getCorsHeaders(request, env),
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

function normalizePathSearch(value) {
  return String(value || "").trim().slice(0, 500);
}

function escapeSqlLike(value) {
  return String(value || "").replace(/[\\%_]/g, (match) => `\\${match}`);
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

function getAdminCredential(request) {
  const authorization = request.headers.get("Authorization") || "";
  const bearerToken = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  const headerToken = request.headers.get("X-Admin-Key") || "";

  return bearerToken || headerToken;
}

async function fingerprintCredential(value) {
  const credential = String(value || "");
  if (!credential || !globalThis.crypto?.subtle) return "";

  const data = new TextEncoder().encode(credential);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function getAdminAccess(request, env) {
  const expectedKey = String(env.ADMIN_API_KEY || "").trim();
  const credential = getAdminCredential(request);
  const fingerprint = await fingerprintCredential(credential);
  if (!expectedKey) return { allowed: false, fingerprint };
  if (isAdminKeyExpired(env)) return { allowed: false, fingerprint };

  return {
    allowed: credential === expectedKey,
    fingerprint,
  };
}

function getClientIp(request) {
  return String(
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For") ||
    ""
  )
    .split(",")[0]
    .trim()
    .slice(0, 128);
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
    console.error("Unable to record admin audit log:", error);
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

  return getLikeCount(env, path);
}

/**
 * Get approved comments for a post
 */
async function getApprovedComments(env, path) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const { results } = await env.DB.prepare(`
    SELECT id, parent_id, author_name, content, created_at, likes_count
    FROM post_comments
    WHERE path = ?1 AND status = 'approved'
    ORDER BY created_at ASC, id ASC
    LIMIT ?2
  `)
    .bind(path, MAX_COMMENTS_PER_POST)
    .all();

  const comments = (results || []).map((comment) => ({
    id: comment.id,
    parentId: comment.parent_id || null,
    authorName: comment.author_name,
    content: comment.content,
    likesCount: Number(comment.likes_count || 0),
    createdAt: formatTimestamp(comment.created_at),
    replies: [],
  }));

  const commentMap = new Map();
  const rootComments = [];

  comments.forEach((comment) => {
    commentMap.set(comment.id, comment);
  });

  comments.forEach((comment) => {
    if (comment.parentId && commentMap.has(comment.parentId)) {
      commentMap.get(comment.parentId).replies.push(comment);
    } else {
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
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `)
    .bind(
      data.path,
      parentId,
      data.pageUrl,
      data.pageTitle,
      data.nickname,
      data.email || null,
      data.website || null,
      data.content
    )
    .run();

  return result.meta?.last_row_id || null;
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
    const pageUrl = normalizeText(payload.pageUrl, 1000);
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
      const id = await createComment(env, {
        path,
        pageUrl,
        pageTitle,
        nickname,
        email,
        website,
        content,
        parentId,
      });

      return jsonResponse(
        request,
        env,
        { id, path, status: "pending", parentId },
        201
      );
    } catch (error) {
      return jsonResponse(
        request,
        env,
        { error: error instanceof Error ? error.message : "Unable to create comment." },
        400
      );
    }
  }

  return jsonResponse(request, env, { error: "Method not allowed." }, 405);
}

async function getAdminSummary(env) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const [likeSummary, commentSummary, commentLikeSummary, recentPending] = await Promise.all([
    env.DB.prepare(`
      SELECT COUNT(*) as total_posts, COALESCE(SUM(count), 0) as total_likes
      FROM post_likes
    `).first(),
    env.DB.prepare(`
      SELECT
        COUNT(*) as total_comments,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_comments,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_comments,
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

  const allowedStatuses = new Set(["pending", "approved", "rejected", "all"]);
  const status = allowedStatuses.has(url.searchParams.get("status"))
    ? url.searchParams.get("status")
    : "pending";
  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 100);
  const pathFilter = normalizePath(url.searchParams.get("path"));

  const whereParts = [];
  const bindings = [];

  if (status !== "all") {
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

  return (results || []).map((comment) => ({
    id: comment.id,
    path: comment.path,
    parentId: comment.parent_id || null,
    parentAuthorName: comment.parent_author_name || "",
    parentContent: comment.parent_content || "",
    pageUrl: comment.page_url,
    pageTitle: comment.page_title,
    authorName: comment.author_name,
    authorEmail: comment.author_email || "",
    content: comment.content,
    likesCount: Number(comment.likes_count || 0),
    status: comment.status,
    createdAt: formatTimestamp(comment.created_at),
    updatedAt: formatTimestamp(comment.updated_at),
  }));
}

async function updateCommentStatus(env, id, status) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const commentId = Number(id);
  if (!Number.isInteger(commentId) || commentId <= 0) {
    return null;
  }

  const result = await env.DB.prepare(`
    UPDATE post_comments
    SET status = ?1,
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

async function listAdminAuditLogs(env, url) {
  if (!env.DB) {
    throw new Error("D1 binding DB is not configured.");
  }

  const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 100);
  const action = String(url.searchParams.get("action") || "").trim().slice(0, 120);
  const whereClause = action ? "WHERE action = ?1" : "";
  const bindings = action ? [action, limit] : [limit];

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
    LIMIT ${action ? "?2" : "?1"}
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

async function handleAdmin(request, env, url) {
  const access = await getAdminAccess(request, env);
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
      url.pathname === "/admin/comments/reject") &&
    request.method === "POST"
  ) {
    const payload = await readJsonBody(request);
    if (!payload) {
      auditAction = "admin.comments.update_failed";
      auditDetails = { reason: "invalid_json" };
      response = jsonResponse(request, env, { error: "Request body must be valid JSON." }, 400);
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
  } else if (url.pathname === "/admin/audit-logs" && request.method === "GET") {
    const auditLogs = await listAdminAuditLogs(env, url);
    auditAction = "admin.audit_logs.list";
    auditDetails = {
      limit: url.searchParams.get("limit") || "50",
      action: String(url.searchParams.get("action") || "").slice(0, 120),
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

      if (url.pathname.startsWith("/admin/")) {
        return handleAdmin(request, env, url);
      }

      // Route to appropriate handler
      if (url.pathname === "/likes") {
        return handleLikes(request, env, url);
      }

      if (url.pathname === "/comments/like") {
        return handleCommentLikes(request, env, url);
      }

      if (url.pathname === "/comments") {
        return handleComments(request, env, url);
      }

      return jsonResponse(request, env, { error: "Not found." }, 404);
    } catch (error) {
      console.error("Worker error:", error);
      return jsonResponse(
        request,
        env,
        {
          error: "Engagement service failed.",
          message: error instanceof Error ? error.message : "Unknown error.",
        },
        500
      );
    }
  },
};
