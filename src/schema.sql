-- Cloudflare D1 Database Schema for Likes and Comments
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