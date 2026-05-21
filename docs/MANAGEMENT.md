# Management & Moderation Guide

[📘 Readme](../README.md) · [⚙️ Installation](./INSTALLATION.md) · [🛠️ Management](./MANAGEMENT.md) · [🚀 Deployment](./DEPLOYMENT.md)

Comments are stored with a `status` field that controls visibility:
- `pending`: Not yet approved (default for new comments)
- `approved`: Visible to public
- `rejected`: Rejected and hidden

This guide shows how to manage comments using the `thread-cf` CLI, Wrangler CLI, and D1.

## Admin Dashboard

The built-in static dashboard in `dashboard/index.html` connects to protected admin endpoints on your Worker. It shows summary metrics, pending/approved/rejected comments, ranked liked/commented paths, and Worker configuration metadata.

Create an admin secret before using it:

```bash
thread-cf admin-key
wrangler secret put ADMIN_API_KEY
```

`thread-cf admin-key` generates a secure key, updates `ADMIN_API_KEY` in `.env`, and lets you choose an expiration. Expiring keys are written to `ADMIN_API_KEY_EXPIRES_AT` as an ISO timestamp; empty means never expires.

Then open the dashboard. It prompts once per browser session for:

- Worker URL: `https://your-worker.workers.dev`
- Admin key: the value you set for `ADMIN_API_KEY`

If the admin key expires or the session is cleared, the dashboard prompts again.

The dashboard uses these protected endpoints:

- `GET /admin/summary`
- `GET /admin/stats?range=30d`
- `GET /admin/comments?status=pending&limit=50`
- `POST /admin/comments/approve`
- `POST /admin/comments/reject`
- `GET /admin/comment-settings`
- `PUT /admin/comment-settings`
- `GET /admin/likes?sort=relevance&direction=desc&path=/blog&limit=25`
- `GET /admin/worker`
- `GET /admin/audit-logs?limit=25`

Do not embed Cloudflare account API tokens in the dashboard. If you later want account-wide Worker listings, add a protected server-side proxy endpoint.

Admin dashboard activity is written to the `admin_audit_logs` D1 table. Logs store action, method, route, response status, client IP, user agent, timestamp, sanitized details, and a short SHA-256 fingerprint of the presented admin key. Raw admin keys and request bodies are not stored.

Comment settings include a denied keyword list. Matching is case-insensitive against comment text and author name. Matches are stored as rejected comments and receive a neutral pending response from the public API.

## CLI Tool (Recommended)

Use the included CLI tool for easy comment management:

```bash
# List all pending comments
D1_DATABASE_NAME=likes-and-comments thread-cf pending

# Approve comment #5
D1_DATABASE_NAME=likes-and-comments thread-cf approve 5

# Reject comment #3
D1_DATABASE_NAME=likes-and-comments thread-cf reject 3

# List all approved comments for a post
D1_DATABASE_NAME=likes-and-comments thread-cf list-approved /blog/my-post

# Show database statistics
D1_DATABASE_NAME=likes-and-comments thread-cf stats

# Run a database health check
D1_DATABASE_NAME=likes-and-comments thread-cf health
```

Or set the environment variable permanently:

```bash
export D1_DATABASE_NAME=likes-and-comments

# Now use without the prefix:
thread-cf pending
thread-cf approve 5
thread-cf reject 3
```

By default, CRUD commands print the Wrangler SQL command they will run. Add `--execute` or `--run` to execute through Wrangler immediately.

## Comment CRUD

```bash
# Create a pending comment
D1_DATABASE_NAME=likes-and-comments thread-cf create-comment \
  /blog/my-post \
  https://example.com/blog/my-post \
  "My Post" \
  "Ada" \
  "Great post!" \
  ada@example.com

# List comments by status, optionally scoped to a path
D1_DATABASE_NAME=likes-and-comments thread-cf list-comments pending
D1_DATABASE_NAME=likes-and-comments thread-cf list-comments approved /blog/my-post

# Read one full comment row
D1_DATABASE_NAME=likes-and-comments thread-cf get-comment 5

# Update comment content
D1_DATABASE_NAME=likes-and-comments thread-cf update-comment 5 "Updated text"

# Change comment status
D1_DATABASE_NAME=likes-and-comments thread-cf set-comment-status 5 approved

# Reset likes on one comment
D1_DATABASE_NAME=likes-and-comments thread-cf reset-comment-likes 5

# Delete a comment
D1_DATABASE_NAME=likes-and-comments thread-cf delete-comment 5
```

Execute immediately:

```bash
D1_DATABASE_NAME=likes-and-comments thread-cf set-comment-status 5 approved --execute
```

## Like CRUD

```bash
# List top liked paths
D1_DATABASE_NAME=likes-and-comments thread-cf list-likes
D1_DATABASE_NAME=likes-and-comments thread-cf list-likes 100

# Read likes for one path
D1_DATABASE_NAME=likes-and-comments thread-cf get-like /blog/my-post

# Create or update likes for one path
D1_DATABASE_NAME=likes-and-comments thread-cf set-like /blog/my-post 10

# Increment likes for one path
D1_DATABASE_NAME=likes-and-comments thread-cf increment-like /blog/my-post
D1_DATABASE_NAME=likes-and-comments thread-cf increment-like /blog/my-post 5

# Delete likes for one path
D1_DATABASE_NAME=likes-and-comments thread-cf delete-like /blog/my-post

# Delete all path likes
D1_DATABASE_NAME=likes-and-comments thread-cf reset-likes
```

## Manual D1 Commands

If you prefer direct SQL:

### List All Pending Comments

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, substr(content, 1, 50) as preview, created_at FROM post_comments WHERE status = 'pending' ORDER BY created_at ASC"
```

### Get Full Comment Details

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT * FROM post_comments WHERE id = 1"
```

### Approve a Comment

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = 5"
```

### Reject a Comment

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE id = 3"
```

### Approve All Comments from a User

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE author_name = 'John Doe' AND status = 'pending'"
```

### List Comments for a Specific Post

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, status, substr(content, 1, 50) as preview FROM post_comments WHERE path = '/blog/my-post' ORDER BY created_at DESC"
```

### Get Statistics

```bash
# Total comments by status
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT status, COUNT(*) as count FROM post_comments GROUP BY status"

# Comments per post
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT path, COUNT(*) as comment_count FROM post_comments GROUP BY path ORDER BY comment_count DESC"

# Total likes
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT COUNT(*) as total_posts, SUM(count) as total_likes FROM post_likes"
```

### Delete a Comment

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "DELETE FROM post_comments WHERE id = 5"
```

### Delete All Comments from a Post

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "DELETE FROM post_comments WHERE path = '/blog/spam-post'"
```

### Reset Likes for a Post

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "DELETE FROM post_likes WHERE path = '/blog/my-post'"
```

## Bulk Operations

### Approve Multiple Comments

Approve all pending comments:

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending'"
```

Approve recent comments (last 7 days):

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND created_at > datetime('now', '-7 days')"
```

### Block User

Reject all comments from a user:

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'rejected', updated_at = CURRENT_TIMESTAMP WHERE author_email = 'spammer@example.com'"
```

Delete all comments from a user:

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "DELETE FROM post_comments WHERE author_email = 'spammer@example.com'"
```

## Advanced Queries

### Find Comments with Suspicious Patterns

```bash
# Find very long comments (possible spam)
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, LENGTH(content) as content_length FROM post_comments WHERE LENGTH(content) > 5000"

# Find comments with many URLs (likely spam)
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, content FROM post_comments WHERE (LENGTH(content) - LENGTH(REPLACE(content, 'http', ''))) / 4 > 3"

# Find comments with @mentions
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, content FROM post_comments WHERE content LIKE '%@%'"
```

### Export Comments

Get comments as JSON for backup:

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT json_group_object(id, json_object('author', author_name, 'email', author_email, 'content', content, 'status', status, 'created', created_at)) FROM post_comments" > comments_backup.json
```

### Archive Old Comments

Mark very old rejected comments for cleanup:

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "DELETE FROM post_comments WHERE status = 'rejected' AND created_at < datetime('now', '-90 days')"
```

## Database Backups

### Export All Data

```bash
# Export likes
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT * FROM post_likes" > likes_backup.json

# Export comments
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT * FROM post_comments" > comments_backup.json
```

### Get Database Schema

```bash
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT sql FROM sqlite_master WHERE type='table'"
```

## Automation Ideas

### Scheduled Approval

Use a scheduled job to auto-approve comments:

```bash
# Approve comments from known users automatically
wrangler d1 execute likes-and-comments --remote --command \
  "UPDATE post_comments SET status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE status = 'pending' AND author_email IN ('friend@example.com', 'colleague@example.com')"
```

### Spam Detection

Check for common spam patterns before approval:

```bash
# Find comments with excessive URLs
wrangler d1 execute likes-and-comments --remote --command \
  "SELECT id, author_name, content FROM post_comments WHERE status = 'pending' AND content LIKE '%.com%' AND content LIKE '%.net%' AND content LIKE '%.io%'"
```

## Webhooks (Future)

Consider implementing webhooks to notify you of new pending comments.
This could trigger email notifications or approval workflows.

## Rate Limiting Considerations

The current implementation uses browser-based localStorage for like deduplication.
For production with high traffic, consider:

1. IP-based rate limiting in Cloudflare
2. Additional validation rules in the worker
3. Database checks for suspicious patterns

See [Deployment Guide](./DEPLOYMENT.md) for production recommendations.

## Support

For issues with D1 or Wrangler:
- [D1 Documentation](https://developers.cloudflare.com/d1/)
- [Wrangler CLI Guide](https://developers.cloudflare.com/workers/wrangler/)
