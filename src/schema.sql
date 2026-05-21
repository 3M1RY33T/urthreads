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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Index for efficient querying of comments by path, status, and parent thread
CREATE INDEX IF NOT EXISTS post_comments_path_status_created_idx
  ON post_comments (path, status, created_at);

CREATE INDEX IF NOT EXISTS post_comments_parent_idx
  ON post_comments (parent_id);

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
