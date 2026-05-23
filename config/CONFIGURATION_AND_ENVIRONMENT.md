# Configuration And Environment

This directory contains environment templates for local setup and Wrangler deployment.

## Files

- `.env.example`: local environment template used by CLI commands and setup.
- `wrangler.toml.example`: Cloudflare Worker deployment template.

Copy these when starting a project:

```bash
cp .env.example ../.env
cp wrangler.toml.example ../wrangler.toml
```

Real `.env` files and `wrangler.toml` files commonly contain local or account-specific values. Do not commit secrets.

## Environment Model

There are two places values may need to exist:

- `.env`: used by local CLI commands, setup helpers, endpoint examples, and generated values.
- `wrangler.toml` or Cloudflare dashboard variables/secrets: used by the deployed Worker at runtime.

Updating `.env` does not automatically update a deployed Worker. After changing runtime values such as `ALLOWED_ORIGINS`, `ADMIN_SESSION_TTL_SECONDS`, or `MAX_COMMENTS_PER_POST`, make sure the deployed Worker environment is updated and redeployed.

Use Wrangler secrets for sensitive runtime values:

```bash
wrangler secret put ADMIN_API_KEY
```

Do not place Cloudflare account API tokens or raw admin keys in browser code.

## Guided Setup

Run:

```bash
thread-cf setup-env
```

or inside this repo:

```bash
npm run setup:env
```

The setup flow asks for:

- Cloudflare account ID
- optional Cloudflare API token for local tooling
- D1 database name and ID
- Worker name and Worker URL
- allowed browser origins
- maximum comments returned per post

It writes a local `.env` with `0600` permissions where supported.

## Required Values

### Cloudflare And D1

```env
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
D1_DATABASE_NAME=likes-and-comments
D1_DATABASE_ID=your-d1-database-id
WORKER_NAME=likes-and-comments-worker
WORKER_URL=https://likes-and-comments-worker.your-subdomain.workers.dev
```

`CLOUDFLARE_API_TOKEN` is optional if you use `wrangler login` locally.

### CORS Origins

```env
ALLOWED_ORIGINS=https://example.com,https://www.example.com
ALLOWED_ORIGINS_STAGING=https://staging.example.com,http://localhost:3000,http://localhost:8787
ALLOWED_ORIGINS_PROD=https://example.com,https://www.example.com
```

Use exact origins. Do not use `*` for dashboard deployments. Browser cookie sessions need credentialed CORS, and credentialed CORS requires a specific `Access-Control-Allow-Origin` value.

Add origins with:

```bash
thread-cf env add-origin http://localhost:8000
thread-cf env add-origin http://[::1]:8000
thread-cf env add-origin https://mysite.com https://www.mysite.com --target prod
```

The first real origin replaces `*`. Later origins are appended without duplicates.

Targets:

- `default` or `local`: updates `ALLOWED_ORIGINS`.
- `staging`: updates `ALLOWED_ORIGINS_STAGING`.
- `prod` or `production`: updates `ALLOWED_ORIGINS_PROD`.

## Client Endpoint Values

```env
LIKES_ENDPOINT=https://likes-and-comments-worker.your-subdomain.workers.dev/likes
COMMENTS_ENDPOINT=https://likes-and-comments-worker.your-subdomain.workers.dev/comments
```

These are convenience values for examples and local integration. The browser still reads the endpoint you configure in your page through `window.LIKES_CONFIG` and `window.COMMENTS_CONFIG`.

## Admin Dashboard Values

```env
ADMIN_API_KEY=replace-with-a-long-random-admin-key
ADMIN_API_KEY_EXPIRES_AT=
ADMIN_SESSION_TTL_SECONDS=3600
```

Generate or rotate the admin key:

```bash
thread-cf admin-key
thread-cf admin-key --expires 30d
```

The command writes the key to `.env` and copies the raw key to your clipboard when possible. It does not print the raw key.

Set the Worker secret:

```bash
wrangler secret put ADMIN_API_KEY
```

Configure dashboard session lifetime:

```bash
thread-cf admin-session --ttl 1h
thread-cf admin-session --ttl 30m
```

`ADMIN_SESSION_TTL_SECONDS` is clamped between 900 and 3600 seconds by the Worker.

## Optional Runtime Values

```env
MAX_COMMENTS_PER_POST=100
```

This controls how many approved comments the public endpoint returns for a post.

## Environment CLI

The `thread-cf env` command manages local `.env` values without exposing secrets by default.

```bash
thread-cf env add-origin <origin...> [--target default|staging|prod]
thread-cf env set <KEY> <VALUE>
thread-cf env get <KEY>
thread-cf env list
thread-cf env open
```

Examples:

```bash
thread-cf env add-origin http://localhost:8000
thread-cf env set WORKER_URL https://my-worker.workers.dev
thread-cf env get ALLOWED_ORIGINS
thread-cf env list
thread-cf env open
```

Sensitive keys containing words like `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` are hidden in command output unless `--show-sensitive` is used.

Open `.env` in a specific viewer:

```bash
thread-cf env open --viewer code
```

## Wrangler Configuration

`wrangler.toml.example` defines:

- Worker name
- Worker entrypoint
- compatibility date
- D1 bindings
- environment-specific Worker names
- runtime vars for local, staging, and production

Minimum shape:

```toml
name = "likes-and-comments-worker"
main = "src/worker.js"
compatibility_date = "2026-05-20"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "likes-and-comments"
database_id = "your-d1-id"

[vars]
ALLOWED_ORIGINS = "https://example.com"
WORKER_NAME = "likes-and-comments-worker"
D1_DATABASE_NAME = "likes-and-comments"
ADMIN_SESSION_TTL_SECONDS = "3600"
```

For staging and production, use Wrangler environments:

```bash
wrangler deploy --env staging
wrangler deploy --env production
```

## D1 Setup

Create a database:

```bash
wrangler d1 create likes-and-comments
```

Initialize the schema:

```bash
wrangler d1 execute likes-and-comments --remote --file=src/schema.sql
```

For production:

```bash
wrangler d1 create likes-and-comments-prod
wrangler d1 execute likes-and-comments-prod --remote --file=src/schema.sql --env production
```

## Deployment Checklist

- Set exact `ALLOWED_ORIGINS`.
- Add the dashboard origin if you use `web/index.html`.
- Set `ADMIN_API_KEY` as a Worker secret.
- Set D1 bindings correctly in `wrangler.toml`.
- Initialize `src/schema.sql`.
- Deploy with `wrangler deploy`.
- Test `/likes?path=/test`.
- Open the dashboard and create a session.

## Common Configuration Issues

### Browser CORS Error

Add the exact browser origin:

```bash
thread-cf env add-origin http://localhost:8000
```

Then update Worker runtime vars and redeploy:

```bash
wrangler deploy
```

### Session Does Not Persist After Refresh

Check:

- The dashboard origin is listed exactly in `ALLOWED_ORIGINS`.
- The Worker response includes `Access-Control-Allow-Credentials: true`.
- The Worker response does not use `Access-Control-Allow-Origin: *`.
- The Worker is deployed after the origin change.

### D1 Binding Is Missing

Check:

- `binding = "DB"` exists in `wrangler.toml`.
- `database_id` matches your Cloudflare D1 database.
- You deployed the environment you edited.
