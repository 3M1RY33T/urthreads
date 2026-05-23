# thread-cf

`thread-cf` is a lightweight engagement system for static websites. It adds page likes, threaded comments, moderation, dashboard analytics, and admin tooling on top of Cloudflare Workers and D1.

It is designed for blogs, portfolios, documentation sites, and other static pages that need interaction without running a traditional server.

## What It Does

- Tracks page likes by path.
- Stores comments and replies in Cloudflare D1.
- Keeps new comments pending until moderated.
- Supports denied keywords for automatic rejection.
- Provides a static admin dashboard for moderation, stats, posts, logs, and Worker metadata.
- Provides CLI tools for setup, environment management, admin keys, sessions, likes, comments, stats, and D1 health checks.
- Uses an `HttpOnly`, `Secure` admin session cookie for the dashboard after the admin key is submitted once.

## Project Layout

- [src](./src/PROGRAM_LOGIC.md): Worker logic, API behavior, database schema, admin session model, audit logs, and CLI modules.
- [config](./config/CONFIGURATION_AND_ENVIRONMENT.md): `.env`, Wrangler configuration, allowed origins, deployment variables, and environment CLI commands.
- [web](./web/DASHBOARD.md): Static dashboard usage, session flow, moderation UI, graph filters, logs, and responsive behavior.
- [test](./test/TESTS.md): Test coverage, how to run tests, and what local checks exist.
- [client](./client): Browser scripts for likes and comments.
- [examples](./examples): Standalone HTML, Jekyll, and dashboard examples.

## Quick Start

Install dependencies and create a D1 database:

```bash
npm install
wrangler login
wrangler d1 create likes-and-comments
```

Initialize the database schema:

```bash
wrangler d1 execute likes-and-comments --remote --file=src/schema.sql
```

Create local environment values:

```bash
npm run setup:env
```

Copy and edit the Wrangler config:

```bash
cp config/wrangler.toml.example wrangler.toml
```

Set exact browser origins. For local dashboard testing, for example:

```bash
thread-cf env add-origin http://localhost:8000
thread-cf env add-origin http://[::1]:8000
```

Deploy:

```bash
wrangler deploy
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
thread-cf admin-key
wrangler secret put ADMIN_API_KEY
thread-cf admin-session --ttl 1h
```

Open [web/index.html](./web/index.html), enter the Worker URL and admin key, and the dashboard will create a short-lived cookie session.

Important: dashboard refresh persistence requires the dashboard's exact browser origin in `ALLOWED_ORIGINS`. Do not use `*` for dashboard sessions.

## Useful CLI Commands

```bash
thread-cf setup-env
thread-cf env add-origin https://example.com
thread-cf env open
thread-cf admin-key
thread-cf admin-session --ttl 1h
thread-cf pending
thread-cf approve 5 --execute
thread-cf reject 5 --execute
thread-cf list-likes
thread-cf stats
thread-cf health
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
