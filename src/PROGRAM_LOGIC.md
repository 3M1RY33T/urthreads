# <img src="../assets/img/urthreads.png" alt="" width="40" height="40" align="left" style="margin-right: 20px;" /> Program Logic

| [Overview](../README.md) | [Dashboard](../web/DASHBOARD.md) | [Configuration And Environment](../config/CONFIGURATION_AND_ENVIRONMENT.md) | *> Program Logic <* | [Tests](../test/TESTS.md) |
| --- | --- | --- | --- | --- |

This directory contains the Worker runtime, local setup helpers, database schema, and CLI entrypoint for `urthreads`.

## Runtime Shape

`src/worker.js` is the Cloudflare Worker. It exposes public engagement endpoints for websites and protected admin endpoints for the dashboard.

Public endpoints:

- `GET /likes?path=/post-path`: returns the current like count for a page path.
- `POST /likes?path=/post-path`: increments the page like count and records a `page_like` engagement event.
- `GET /comments?path=/post-path`: returns approved, non-hidden comments for a page path as a nested thread.
- `POST /comments`: creates a pending comment or reply.
- `GET /comments/like?commentId=123`: returns a comment's like count.
- `POST /comments/like?commentId=123`: increments a comment's like count and records a `comment_like` engagement event.

Protected admin endpoints:

- `POST /admin/session`: accepts the admin key once and sets an `HttpOnly`, `Secure` session cookie.
- `GET /admin/session`: verifies the current cookie session.
- `DELETE /admin/session`: expires the session cookie.
- `GET /admin/summary`: returns totals for likes, comment likes, and moderation counts.
- `GET /admin/stats?range=30d&start=YYYY-MM-DD`: returns engagement buckets for the dashboard graph.
- `GET /admin/comments?status=pending&limit=50&path=/post-path`: returns comments for moderation.
- `POST /admin/comments/approve`: sets a comment to approved and clears `hidden_at`.
- `POST /admin/comments/reject`: sets a comment to rejected and clears `hidden_at`.
- `POST /admin/comments/hide`: keeps a comment approved but sets `hidden_at`.
- `POST /admin/comments/unhide`: clears `hidden_at`.
- `POST /admin/comments/delete`: permanently deletes the selected comment and its child replies.
- `GET /admin/likes?sort=relevance&direction=desc&limit=25`: lists ranked post paths.
- `GET/POST/PUT /admin/comment-settings`: reads or replaces denied keywords.
- `GET /admin/audit-logs`: lists protected dashboard activity.
- `GET /admin/worker`: returns Worker metadata that the dashboard can display.

Direct API clients may still use `Authorization: Bearer <ADMIN_API_KEY>` or `X-Admin-Key: <ADMIN_API_KEY>` for admin endpoints. The dashboard flow should use `/admin/session` and the cookie session instead.

## Likes Logic

Likes are keyed by normalized page path. Paths must start with `/` and are capped to a safe length.

When a page like is submitted:

1. The Worker validates the path.
2. `post_likes` is inserted or updated.
3. The count is incremented atomically in D1.
4. A `page_like` row is written to `engagement_events`.
5. The updated count is returned.

Client-side duplicate prevention is handled in `client/likes.js` with browser `localStorage`. That prevents accidental repeat likes from the same browser, but it is not a security boundary. Use Cloudflare rate limiting for hostile traffic.

## Comment Logic

Comments are stored in `post_comments`.

Important fields:

- `parent_id`: points to another comment for replies.
- `status`: `pending`, `approved`, or `rejected`.
- `hidden_at`: hides an approved comment without changing its status.
- `likes_count`: stores comment likes.

Public comment submissions are validated for path, title, URL, nickname, email format, and content length. The `website` field acts as a honeypot; if it is filled, the Worker returns a neutral pending response without creating a public comment.

Denied keywords are stored in `comment_denied_keywords`. Matching is case-insensitive against comment content and author name. A matching comment is stored as `rejected`, but the public response remains neutral so blocked users do not get a useful spam signal.

Approved comments are returned as a nested tree. Hidden approved comments and rejected comments are excluded from public comment loading.

## Thread Moderation Logic

The dashboard receives a full enough thread context for moderation:

- When a filtered comment matches, the admin list also includes ancestors and descendants needed to understand the thread.
- Hiding a comment sets `hidden_at`. The dashboard treats child replies as inactive while the parent is hidden.
- Unhiding the parent restores its children in the view.
- Deleting a parent comment permanently deletes its descendant replies through a recursive D1 query.

This gives moderators a reversible hide path and a permanent delete path.

## Admin Session Logic

The dashboard should not keep the raw admin key after login.

Flow:

1. The dashboard sends the admin key to `POST /admin/session`.
2. The Worker validates the key using timing-safe comparison.
3. The Worker creates a signed session token.
4. The token is sent only as an `HttpOnly`, `Secure` cookie scoped to `/admin`.
5. The dashboard sends later admin requests with `credentials: include`.

The Worker chooses `SameSite=Lax` for same-origin dashboard use and `SameSite=None` for cross-origin dashboard requests. Cross-origin cookie sessions require exact CORS origins. `ALLOWED_ORIGINS=*` cannot support secure browser credential requests.

`ADMIN_SESSION_TTL_SECONDS` controls session lifetime and is clamped between 15 minutes and one hour.

## Audit Logs

Protected dashboard activity is written to `admin_audit_logs`.

Logs include:

- action
- HTTP method
- route path
- response status
- client IP
- user agent
- sanitized details
- credential or session fingerprint
- timestamp

Raw admin keys and request bodies are not stored.

## Engagement Stats

`engagement_events` stores append-only events for:

- `page_like`
- `comment_like`
- `comment_create`

The admin stats endpoint combines these events with moderation actions from `admin_audit_logs`. The dashboard can request 1, 7, 14, or 30 day scopes from a selected start date.

## Database Schema

Run the schema once per D1 database:

```bash
wrangler d1 execute your-threads --remote --file=src/schema.sql
```

Tables:

- `post_likes`: page like counts by path.
- `post_comments`: comments, replies, statuses, hidden timestamps, and comment likes.
- `comment_denied_keywords`: admin-controlled auto-rejection keywords.
- `engagement_events`: append-only stats events.
- `admin_audit_logs`: protected dashboard activity logs.

The Worker also contains compatibility helpers for older databases, such as ensuring `hidden_at` and the denied keyword table exist.

## CLI Files

- `urthreads.js`: public CLI entrypoint and command router.
- `setup-env.js`: guided `.env` creation.
- `env-config.js`: local `.env` inspection and updates, including allowed origins.
- `example-config.js`: browser-safe Worker config generation for static examples.
- `wrangler-config.js`: guided `wrangler.toml` creation and updates.
- `admin-key.js`: admin key generation and rotation.
- `admin-session.js`: session TTL configuration.
- `backout.js`: local cleanup, cache reset, and guarded Worker deletion commands.
- `cli.js`: moderation, like, stats, and health commands that generate or execute Wrangler D1 SQL.

Useful commands:

```bash
urthreads setup-env
urthreads wrangler-init
urthreads wrangler set database_id your-d1-id
urthreads env add-origin http://localhost:8000
urthreads env open
urthreads admin-key
urthreads admin-session --ttl 1h
urthreads clean --dry-run
urthreads clean
urthreads clean-all
urthreads clean-all --delete-worker --delete-database
urthreads delete-worker --name urthreads-worker
urthreads pending
urthreads approve 5 --execute
urthreads stats
urthreads health
```

Most D1 management commands print the Wrangler command by default. Add `--execute` or `--run` when you want the CLI to run it immediately.

## Runtime Limits And Validation

Current limits:

- Path must start with `/`.
- Path length is capped.
- Nickname is capped to 80 characters.
- Email is capped to 254 characters and checked for basic format.
- Page URL is capped to 1000 characters.
- Page title is capped to 300 characters.
- Comment content is capped to 2000 characters.
- Public comment returns are limited by `MAX_COMMENTS_PER_POST`.

Recommended production controls:

- Keep `ALLOWED_ORIGINS` exact.
- Use HTTPS.
- Use Cloudflare rate limiting for `/likes`, `/comments`, and `/comments/like`.
- Review rejected and hidden comments regularly.
- Back up D1 data before destructive maintenance.
