/**
 * Cloudflare Worker for Likes and Comments
 * 
 * This worker handles POST likes and comments using Cloudflare D1 database.
 * It provides a lightweight engagement API for static websites.
 * 
 * Required bindings:
 * - DB: Cloudflare D1 database (must have schema from schema.sql)
 * 
 * Required environment variables:
 * - ALLOWED_ORIGINS: Comma-separated list of allowed origins (or "*" for all)
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
      "Access-Control-Allow-Headers": "Accept, Content-Type",
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
