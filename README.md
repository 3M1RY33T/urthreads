| *> Overview <* | [Dashboard](./web/DASHBOARD.md) | [Configuration And Environment](./config/CONFIGURATION_AND_ENVIRONMENT.md) | [Program Logic](./src/PROGRAM_LOGIC.md) | [Tests](./test/TESTS.md) |
| --- | --- | --- | --- | --- |

# Urthreads

`urthreads` is self-hosted software for adding engagement features to static websites. It is not a hosted service: you deploy the Worker to your own Cloudflare account, connect it to your own D1 database, and manage the dashboard with your own admin key.

It adds page likes, threaded comments, moderation, dashboard analytics, and admin tooling for blogs, portfolios, documentation sites, and other static pages that need interaction without running a traditional server.

## What It Does

- Tracks page likes by path.
- Stores comments and replies in Cloudflare D1.
- Keeps new comments pending until moderated.
- Supports denied keywords for automatic rejection.
- Provides a static admin dashboard for moderation, stats, posts, logs, and Worker metadata.
- Provides CLI tools for setup, environment management, admin keys, sessions, likes, comments, stats, and D1 health checks.
- Uses an `HttpOnly`, `Secure` admin session cookie for the dashboard after the admin key is submitted once.

## Quick Start

The recommended path is to use the published package CLI. It keeps setup boring in the best way: it asks for the Cloudflare, D1, Worker, CORS, and dashboard values it needs, then writes a local `.env` and can create `wrangler.toml` for you.

```bash
npm install -g urthreads
wrangler login
wrangler d1 create your-threads
urthreads setup-env
```

The guided setup asks for:

- Cloudflare account ID
- optional Cloudflare API token for local tooling
- D1 database name and ID
- Worker name and Worker URL
- allowed browser origins
- maximum comments returned per post

It writes a local `.env` with restricted file permissions where your platform supports them.
It also offers to create `wrangler.toml` from the same answers. You can create it separately later with:

```bash
urthreads wrangler-init
```

Adjust Wrangler values without opening the file:

```bash
urthreads wrangler set account_id your-account-id
urthreads wrangler set database_id your-d1-database-id
urthreads wrangler set ALLOWED_ORIGINS https://example.com
```

Initialize the database schema and deploy:

```bash
wrangler d1 execute your-threads --remote --file=src/schema.sql
wrangler deploy
```

### Manual Repository Setup

If you download or clone the repository instead of using the published package, install dependencies and run the same setup command through npm:

```bash
npm install
npm run setup:env
```

The local npm script calls the same CLI flow as `urthreads setup-env`. You can also run the repo entrypoint directly:

```bash
node src/thread-cf.js setup-env
```

## Website Usage

Configure the browser scripts with your Worker endpoints:

```html
<script>
  window.LIKES_CONFIG = {
    endpoint: "https://your-worker.workers.dev/likes"
  };
  window.COMMENTS_CONFIG = {
    endpoint: "https://your-worker.workers.dev/comments"
  };
</script>
<script src="/path/to/likes.js"></script>
<script src="/path/to/comments.js"></script>
```

Add a like button:

```html
<button data-like-button data-path="/blog/my-post">
  Like (<span data-like-count>0</span>)
</button>
```

Add a comments container:

```html
<div
  data-worker-comments
  data-page-id="/blog/my-post"
  data-page-url="https://example.com/blog/my-post"
  data-page-title="My Post"
>
  <div data-comment-list></div>
  <div data-comment-status></div>
  <form data-comment-draft-form>
    <textarea name="content" required></textarea>
    <button type="submit" data-comment-send>Post</button>
  </form>
</div>
```

Complete examples live in [examples](./examples).

## Dashboard Usage

Generate an admin key:

```bash
urthreads admin-key
wrangler secret put ADMIN_API_KEY
urthreads admin-session --ttl 1h
```

Open [web/index.html](./web/index.html), enter the Worker URL and admin key, and the dashboard will create a short-lived cookie session.

Important: dashboard refresh persistence requires the dashboard's exact browser origin in `ALLOWED_ORIGINS`. Do not use `*` for dashboard sessions.

## Useful CLI Commands

```bash
urthreads setup-env                       # Create local .env interactively
urthreads wrangler-init                   # Create wrangler.toml interactively
urthreads wrangler set database_id d1-id  # Update wrangler.toml D1 ID
urthreads env add-origin https://example.com # Add an allowed browser origin
urthreads env open                        # Open .env in a viewer
urthreads admin-key                       # Generate or rotate admin key
urthreads admin-session --ttl 1h          # Set dashboard session lifetime
urthreads pending                         # List pending comments
urthreads approve 5 --execute             # Approve comment 5
urthreads reject 5 --execute              # Reject comment 5
urthreads list-likes                      # List liked paths
urthreads stats                           # Show database stats
urthreads health                          # Run D1 health check
```

Most D1 management commands print the Wrangler command by default. Add `--execute` or `--run` to run it immediately.

## Development

Run tests:

```bash
npm test
```

Run local Worker development:

```bash
wrangler dev
```

Serve the dashboard locally:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000/web/index.html` or `http://[::1]:8000/web/index.html`.

## Upcoming Changes

- Optional Cloudflare Access or identity-provider setup notes for teams that want MFA in front of the dashboard.
- Notification hooks for pending comments.
- More production hardening examples, including rate limiting and scheduled cleanup.
- Broader Worker integration tests for deployed or local Wrangler environments.
- Packaging cleanup for the final npm publish surface.
