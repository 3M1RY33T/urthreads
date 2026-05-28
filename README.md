# <img src="assets/img/urthreads.png" alt="" width="40" height="40" align="left" style="margin-right: 20px;" /> Urthreads

| *> Overview <* | [Dashboard](./web/DASHBOARD.md) | [Configuration And Environment](./config/CONFIGURATION_AND_ENVIRONMENT.md) | [Program Logic](./src/PROGRAM_LOGIC.md) | [Tests](./test/TESTS.md) |
| --- | --- | --- | --- | --- |

`urthreads` is self-hosted engagement software for static websites. Deploy the Cloudflare Worker, connect it to your own D1 database, and moderate likes, threaded comments, posts, logs, and stats from the static dashboard.

![Overview](./assets/img/dashboard-overview.png)

It adds page likes, threaded comments, moderation, dashboard analytics, and admin tooling for blogs, portfolios, documentation sites, and other static pages that need interaction without running a traditional server.

### Before We Begin...

Special thanks to [lostinurarms1](https://www.deviantart.com/lostinurarms1) for the logo design. You can submit your own request from their Fiverr page to get a specialized logo!

## What It Does

- Tracks page likes and comment likes by path.
- Stores comments and replies in Cloudflare D1.
- Keeps new comments pending until moderated.
- Supports denied keywords for automatic rejection.
- Provides a static admin dashboard for moderation, analytics, posts, logs, and Worker metadata.
- Provides CLI tools for setup, env syncing, admin keys, sessions, dashboard builds, cleanup, stats, and D1 checks.
- Uses an `HttpOnly`, `Secure` admin session cookie after the admin key is submitted once.

## Quick Start

```bash
npm install -g urthreads
wrangler login
urthreads setup-env
```

The guided setup can create or reuse a D1 database, write `.env`, create `wrangler.toml`, initialize the schema, deploy the Worker, and sync safe browser example config. Create Wrangler config later with:

```bash
urthreads wrangler-init
```

Common follow-up commands:

```bash
urthreads wrangler set database_id your-d1-database-id
urthreads env add-origin https://example.com --staging --production
wrangler d1 execute your-threads --remote --file=src/schema.sql
wrangler deploy
```

For a cloned repository instead of the published package:

```bash
npm install
npm run setup:env
```

See [Configuration And Environment](./config/CONFIGURATION_AND_ENVIRONMENT.md) for all `.env`, `wrangler.toml`, origin, secret, and deployment details.

## Website Usage

Configure browser scripts with your Worker endpoints:

```html
<script>
  window.LIKES_CONFIG = { endpoint: "https://your-worker.workers.dev/likes" };
  window.COMMENTS_CONFIG = { endpoint: "https://your-worker.workers.dev/comments" };
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

Add comments:

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

Complete examples live in the [examples directory](https://github.com/3M1RY33T/urthreads/tree/main/examples). For static HTML examples, run `urthreads setup-env` or set `WORKER_URL`; you can also append `?worker=https://your-worker.workers.dev`.

## Dashboard

Create dashboard credentials:

```bash
urthreads admin-key
urthreads admin-session --ttl 1h
```

`admin-key` writes the key to `.env`, copies it to your clipboard, and can optionally store it as the Worker secret. `admin-session` syncs session TTL to `.env` and `wrangler.toml`, then offers to deploy.

Run the dashboard locally from [web/index.html](./web/index.html), or host it under your site:

```bash
urthreads dashboard set ./public urthreads
urthreads dashboard build
```

`dashboard set` stores `DASHBOARD_LOCAL_PATH` and `DASHBOARD_ENDPOINT`, builds to `./public/urthreads/`, and copies required assets. Later `dashboard build` refreshes that saved install; if no path is saved, it prompts for one. Missing output paths are created only after confirmation.

For production dashboard hosting, add the dashboard origin, not its path:

```bash
urthreads env add-origin https://www.myblog.com
urthreads wrangler set ALLOWED_ORIGINS https://www.myblog.com
wrangler deploy
```

Then open `https://www.myblog.com/urthreads/` and enter your Worker API URL. See [Dashboard](./web/DASHBOARD.md) for UI behavior, login flow, moderation, stats, and responsive layout details.

## Cleanup

Use these when testing setup again or backing out a deployment:

```bash
urthreads clean --dry-run
urthreads clean
urthreads clean-all
urthreads clean-all --delete-worker
urthreads clean-all --delete-worker --delete-database
urthreads delete-worker --name urthreads-worker
```

`clean` removes caches, local working files, and copied dashboard files while keeping database/config files. `clean-all` also removes `.env`, `wrangler.toml`, and `.dev.vars`; it can delete the Worker and then optionally the inferred D1 database. Dashboard cleanup removes copied urthreads files only, leaving directories and unrelated site files in place.

## Development

```bash
npm test
npm run check
wrangler dev
python3 -m http.server 8000
```

Serve the dashboard at `http://localhost:8000/web/index.html` or `http://[::1]:8000/web/index.html`. The exact browser origin must be in `ALLOWED_ORIGINS` for cookie sessions.

## More Docs

- [Dashboard](./web/DASHBOARD.md): admin UI, login, moderation, stats, and local dashboard development.
- [Configuration And Environment](./config/CONFIGURATION_AND_ENVIRONMENT.md): `.env`, `wrangler.toml`, origins, secrets, dashboard path, cleanup, and deployment checklist.
- [Program Logic](./src/PROGRAM_LOGIC.md): Worker endpoints, database behavior, session logic, audit logs, and runtime limits.
- [Tests](./test/TESTS.md): test files, local checks, and coverage focus.

## Contributing

Contributions are welcome. Before opening a pull request, read [CONTRIBUTING.md](./CONTRIBUTING.md), keep changes focused, and run:

```bash
npm test
npm run check
```

Please do not report security vulnerabilities in public issues. Use the private reporting guidance in [SECURITY.md](./SECURITY.md).

## Upcoming Changes

- Optional Cloudflare Access or identity-provider setup notes for teams that want MFA in front of the dashboard.
- Widget-style overview display with configurable statistics.
- Comment approval settings, including auto-approve and rejected-comment cleanup.
- Broader Worker integration tests for deployed or local Wrangler environments.
