# <img src="../assets/img/urthreads.png" alt="" width="40" height="40" align="left" style="margin-right: 20px;" /> Configuration And Environment

| [Overview](../README.md) | [Dashboard](../web/DASHBOARD.md) | *> Configuration And Environment <* | [Program Logic](../src/PROGRAM_LOGIC.md) | [Tests](../test/TESTS.md) |
| --- | --- | --- | --- | --- |

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
urthreads admin-key
wrangler secret put ADMIN_API_KEY
```

Do not place Cloudflare account API tokens or raw admin keys in browser code.

## Guided Setup

Run:

```bash
urthreads setup-env
```

or inside this repo:

```bash
npm run setup:env
```

The setup flow asks for:

- Wrangler authentication, if it is available locally
- D1 database name, with an option to create the database automatically. Example: `your-threads`.
- D1 database ID only when automatic creation is skipped or unavailable
- optional Cloudflare account ID/API token for advanced local tooling
- Worker name and Worker URL
- allowed browser origins
- maximum comments returned per post
- optional D1 schema initialization and Worker deployment when a workers.dev subdomain is provided

It writes a local `.env` with `0600` permissions where supported. It also offers to create `wrangler.toml` from the same answers.

If `wrangler.toml` already exists, setup will not overwrite it silently. After you choose to create `wrangler.toml`, it asks again before replacing the existing file, and the default answer is no. This avoids clobbering custom Wrangler configuration. If setup creates or records a new D1 database but you keep the existing `wrangler.toml`, your `.env` and `wrangler.toml` may point at different database values until you update Wrangler config separately:

```bash
urthreads wrangler set database_name your-threads
urthreads wrangler set database_id your-d1-id
```

Create only `wrangler.toml`:

```bash
urthreads wrangler-init
```

## Required Values

### Cloudflare And D1

```env
CLOUDFLARE_ACCOUNT_ID=your-cloudflare-account-id
CLOUDFLARE_API_TOKEN=your-cloudflare-api-token
D1_DATABASE_NAME=your-threads
D1_DATABASE_ID=your-d1-database-id
WORKER_NAME=urthreads-worker
WORKER_URL=
```

`CLOUDFLARE_API_TOKEN` is optional if you use `wrangler login` locally.
Leave `WORKER_URL` blank until after deployment if you do not know the final `workers.dev` URL yet. Set it later with `urthreads env set WORKER_URL https://your-worker.workers.dev`.

### CORS Origins

```env
ALLOWED_ORIGINS=https://example.com,https://www.example.com,http://localhost:8000,http://[::1]:8000
ALLOWED_ORIGINS_STAGING=https://staging.example.com,http://localhost:3000,http://localhost:8000,http://[::1]:8000,http://localhost:8787
ALLOWED_ORIGINS_PROD=https://example.com,https://www.example.com
```

Use exact origins. Do not use `*` for dashboard deployments. Browser cookie sessions need credentialed CORS, and credentialed CORS requires a specific `Access-Control-Allow-Origin` value.

If your dashboard is hosted at:

```text
https://www.myblog.com/urthreads/
```

the origin to add is:

```text
https://www.myblog.com
```

Do not include the `/urthreads/` path in `ALLOWED_ORIGINS`.

Add origins with:

```bash
urthreads env add-origin http://localhost:8000
urthreads env add-origin http://[::1]:8000
urthreads env add-origin https://mysite.com https://www.mysite.com --target prod
```

The first real origin replaces `*`. Later origins are appended without duplicates.

Targets:

- `default` or `local`: updates `ALLOWED_ORIGINS`.
- `staging`: updates `ALLOWED_ORIGINS_STAGING`.
- `prod` or `production`: updates `ALLOWED_ORIGINS_PROD`.

## Client Endpoint Values

```env
LIKES_ENDPOINT=
COMMENTS_ENDPOINT=
```

These are convenience values for examples and local integration. `urthreads setup-env`, `urthreads env set WORKER_URL ...`, and `urthreads wrangler set WORKER_URL ...` also update `examples/urthreads-worker-config.js`, a browser-safe file loaded by the static HTML examples. The browser cannot read `.env` or `wrangler.toml` directly; it reads the generated example config or the endpoints you configure in your page through `window.LIKES_CONFIG` and `window.COMMENTS_CONFIG`.

The generated example config also supports a runtime override:

```text
http://localhost:8000/examples/standalone-html/?worker=https://your-worker.workers.dev
```

If examples are served from `http://localhost:8000` or `http://[::1]:8000`, that exact origin must be in `ALLOWED_ORIGINS` on the deployed Worker.

For dashboard and setup workflows, copy local values to your clipboard without printing them:

```bash
urthreads env copy-worker-url
urthreads env copy-admin-key
urthreads env copy D1_DATABASE_ID
urthreads env copy CLOUDFLARE_ACCOUNT_ID
```

## Admin Dashboard Values

```env
ADMIN_API_KEY=replace-with-a-long-random-admin-key
ADMIN_API_KEY_EXPIRES_AT=
ADMIN_SESSION_TTL_SECONDS=3600
```

Generate or rotate the admin key:

```bash
urthreads admin-key
urthreads admin-key --expires 30d
```

The command writes the key to `.env` and copies the raw key to your clipboard when possible. It does not print the raw key.
It can also prompt to store the key as a Worker secret. If the key expires, it can update `ADMIN_API_KEY_EXPIRES_AT` in `wrangler.toml` and deploy the Worker so the expiration is active.

If you skip that prompt, update and deploy manually with the timestamp from the CLI output:

```bash
urthreads wrangler set ADMIN_API_KEY_EXPIRES_AT "2026-06-01T02:26:56.380Z"
wrangler deploy
```

Copy the key again without printing it:

```bash
urthreads env copy-admin-key
```

Configure dashboard session lifetime:

```bash
urthreads admin-session --ttl 1h
urthreads admin-session --ttl 30m
```

`ADMIN_SESSION_TTL_SECONDS` is clamped between 900 and 3600 seconds by the Worker.

## Optional Runtime Values

```env
MAX_COMMENTS_PER_POST=100
```

This controls how many approved comments the public endpoint returns for a post.

## Environment CLI

The `urthreads env` command manages local `.env` values without exposing secrets by default.

```bash
urthreads env add-origin <origin...> [--target default|staging|prod]
urthreads env set <KEY> <VALUE>
urthreads env get <KEY>
urthreads env list
urthreads env open
```

Examples:

```bash
urthreads env add-origin http://localhost:8000
urthreads env set WORKER_URL https://my-worker.workers.dev
urthreads env get ALLOWED_ORIGINS
urthreads env list
urthreads env open
```

Sensitive keys containing words like `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, or `CREDENTIAL` are hidden in command output unless `--show-sensitive` is used.

Open `.env` in a specific viewer:

```bash
urthreads env open --viewer code
```

## Back-Out And Reset Commands

Use the back-out commands to test the setup flow from a clean local state.

```bash
urthreads clean --dry-run
urthreads clean
urthreads clean-all
urthreads clean-all --delete-worker
urthreads clean-all --delete-worker --delete-database
urthreads delete-worker --name urthreads-worker
urthreads delete-worker --name urthreads-worker --delete-database
```

- `clean` is the recommended everyday reset. It removes caches and local working files while keeping your D1 database and configuration files.
- `clean-all` is the recommended full setup reset. It removes caches, working files, `.env`, `wrangler.toml`, and `.dev.vars`, and asks whether to delete the deployed Worker first.
- `clean-cache` removes local cache directories such as `.wrangler`, `.mf`, and `node_modules/.cache`.
- `clean-files` removes generated local environment files such as `.env`, `wrangler.toml`, and `.dev.vars`. Add `--cache` to include caches too.
- `clean-env` removes `.env` and `wrangler.toml`, and asks whether to delete the deployed Worker first.
- When a Worker is being deleted, the CLI also asks whether to delete the inferred D1 database. Pass `--delete-database` only when you intentionally want to remove stored likes, comments, and moderation data. Pass `--database <name>` if the database name cannot be inferred.
- `delete-worker` runs `wrangler delete` only after a warning and confirmation, then recommends cleaning local environment, cache, and working files that refer to the deleted Worker. Pass `--name <worker>` if the Worker name cannot be inferred from `wrangler.toml` or `.env`, or `--keep-local` if you intentionally want to leave local setup files in place.

Prefer `clean` and `clean-all` unless you need one narrow operation. Add `--dry-run` to preview local cleanup or Worker deletion commands without removing anything. Add `--yes` only for automation where you intentionally want to skip interactive prompts.

## Wrangler Configuration

`wrangler.toml.example` defines:

- Worker name
- Worker entrypoint
- compatibility date
- D1 bindings
- environment-specific Worker names
- runtime vars for local, staging, and production

Create it interactively:

```bash
urthreads wrangler-init
```

Manage it without opening the file:

```bash
urthreads wrangler set name urthreads-worker
urthreads wrangler set account_id your-account-id
urthreads wrangler set database_id your-d1-id
urthreads wrangler set ALLOWED_ORIGINS https://example.com
urthreads wrangler set database_id prod-d1-id --env production
urthreads wrangler get ALLOWED_ORIGINS
urthreads wrangler list
urthreads wrangler open
```

Supported `set`/`get` keys:

- `name`
- `main`
- `compatibility_date`
- `account_id`
- `workers_dev`
- `database_name`
- `database_id`
- `ALLOWED_ORIGINS`
- `WORKER_NAME`
- `D1_DATABASE_NAME`
- `ADMIN_API_KEY_EXPIRES_AT`
- `ADMIN_SESSION_TTL_SECONDS`
- `MAX_COMMENTS_PER_POST`

Minimum shape:

```toml
name = "urthreads-worker"
main = "src/worker.js"
compatibility_date = "2026-05-20"
workers_dev = true

[[d1_databases]]
binding = "DB"
database_name = "your-threads"
database_id = "your-d1-id"

[vars]
  ALLOWED_ORIGINS = "https://example.com"
  WORKER_NAME = "urthreads-worker"
  WORKER_URL = ""
  D1_DATABASE_NAME = "your-threads"
  ADMIN_SESSION_TTL_SECONDS = "3600"
```

For staging and production, use Wrangler environments:

```bash
wrangler deploy --env staging
wrangler deploy --env production
```

## D1 Setup

`urthreads setup-env` can create the default D1 database for you through Wrangler. To create one manually instead:

```bash
wrangler d1 create your-threads
```

Example names:

- Default/local D1 database: `your-threads`
- Production D1 database: `your-threads-prod`
- Staging D1 database: `your-threads-staging`

Initialize the schema:

```bash
wrangler d1 execute your-threads --remote --file=src/schema.sql
```

For production:

```bash
wrangler d1 create your-threads-prod
wrangler d1 execute your-threads-prod --remote --file=src/schema.sql --env production
```

## Deployment Checklist

- Set exact `ALLOWED_ORIGINS`.
- Add the dashboard origin if you host `web/index.html`, such as `https://www.myblog.com` for `https://www.myblog.com/urthreads/`.
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
urthreads env add-origin http://localhost:8000
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
