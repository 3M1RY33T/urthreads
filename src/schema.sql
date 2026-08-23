-- Cloudflare D1 Database Schema for Threads
-- Execute this in your D1 database during initial setup

CREATE TABLE IF NOT EXISTS post_likes (
  path TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS post_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT NOT NULL,
  parent_id INTEGER,
  page_url TEXT NOT NULL,
  page_title TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT,
  author_website TEXT,
  content TEXT NOT NULL,
  likes_count INTEGER NOT NULL DEFAULT 0 CHECK (likes_count >= 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  hidden_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying of comments by path, status, and parent thread
CREATE INDEX IF NOT EXISTS post_comments_path_status_created_idx
  ON post_comments (path, status, created_at);

CREATE INDEX IF NOT EXISTS post_comments_parent_idx
  ON post_comments (parent_id);

CREATE TABLE IF NOT EXISTS comment_denied_keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK (event_type IN ('page_like', 'comment_like', 'comment_create')),
  path TEXT NOT NULL,
  comment_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS engagement_events_type_created_idx
  ON engagement_events (event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS engagement_events_path_created_idx
  ON engagement_events (path, created_at DESC);

CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  admin_key_fingerprint TEXT,
  client_ip TEXT,
  user_agent TEXT,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_audit_logs_created_idx
  ON admin_audit_logs (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS admin_audit_logs_action_created_idx
  ON admin_audit_logs (action, created_at DESC);

-- Brute-force protection: failed admin login attempts keyed by client IP and
-- credential fingerprint. One row per (bucket_key, window_start); the worker
-- upserts the counter and lockout_until via INSERT ... ON CONFLICT and mirrors
-- the in-memory rate limiter. Idempotent ensure* DDL also runs in the worker.
CREATE TABLE IF NOT EXISTS auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  lockout_until INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS auth_attempts_bucket_key_idx
  ON auth_attempts (bucket_key, window_start);

-- Public POST endpoint rate limiting keyed by client IP and endpoint.
-- One row per (bucket_key, endpoint, window_start); the worker upserts the
-- counter and lockout_until via INSERT ... ON CONFLICT, mirroring auth_attempts.
CREATE TABLE IF NOT EXISTS public_rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bucket_key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  lockout_until INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (bucket_key, endpoint, window_start)
);

CREATE INDEX IF NOT EXISTS public_rate_limits_bucket_idx
  ON public_rate_limits (bucket_key, endpoint, window_start);

-- D1-backed admin session revocation: each issued session gets a row so it
-- can be individually revoked. pruneExpiredAdminSessions cleans up old rows.
CREATE TABLE IF NOT EXISTS admin_sessions (
  jti TEXT PRIMARY KEY,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx
  ON admin_sessions (expires_at);
