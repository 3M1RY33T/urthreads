# <img src="../assets/img/urthreads.png" alt="" width="40" height="40" align="left" style="margin-right: 20px;" /> Configuration And Environment

| [Overview](../README.md) | [Dashboard](../web/DASHBOARD.md) | *> Configuration And Environment <* | [Program Logic](../src/PROGRAM_LOGIC.md) | [Tests](../test/TESTS.md) |
| --- | --- | --- | --- | --- |

This directory contains environment templates for local setup and Wrangler deployment.

## Files

- `.env.example`: local environment template used by CLI commands and setup.
- `wrangler.toml.example`: Cloudflare Worker deployment template.

From the repository root, copy these when starting a project:

```bash
cp config/.env.example .env
cp config/wrangler.toml.example wrangler.toml
```

Real `.env` files and `wrangler.toml` files commonly contain local or account-specific values. Do not commit secrets.

## Environment Model

There are two places values may need to exist:

- `.env`: used by local CLI commands, setup helpers, endpoint examples, and generated values.
- `wrangler.toml` or Cloudflare dashboard variables/secrets: used by the deployed Worker at runtime.

Updating `.env` does not automatically update a deployed Worker. After changing runtime values such as `ALLOWED_ORIGINS`, `ADMIN_SESSION_TTL_SECONDS`, `ADMIN_SESSION_COOKIE_SAMESITE`, or `MAX_COMMENTS_PER_POST`, make sure the deployed Worker environment is updated and redeployed.

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
ALLOWED_ORIGINS=http://localhost:8000,http://[::1]:8000
ALLOWED_ORIGINS_STAGING=http://localhost:3000,http://localhost:8000,http://[::1]:8000,http://localhost:8787
ALLOWED_ORIGINS_PROD=http://localhost:8000,http://[::1]:8000
```

Use exact origins. `*` is rejected by the Worker for dashboard deployments: the CLI refuses to set it, and the Worker never returns `Access-Control-Allow-Origin: *` on `/admin/*` even if a wildcard is configured some other way. Browser cookie sessions need credentialed CORS, and credentialed CORS requires a specific `Access-Control-Allow-Origin` value.
Setup defaults are localhost-only for safety. Add your deployed website or dashboard origin before production use.

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
urthreads env add-origin https://dashboard.mysite.com --staging --production
```

The first real origin replaces `*`. Later origins are appended without duplicates. The CLI refuses to set `*` as an allowed origin, and the Worker rejects wildcard CORS on admin routes.
Origin changes are also synced to `wrangler.toml` when it exists.

Targets:

- `default` or `local`: updates `ALLOWED_ORIGINS`.
- `staging`: updates `ALLOWED_ORIGINS_STAGING`.
- `prod` or `production`: updates `ALLOWED_ORIGINS_PROD`.
- `--staging` and `--production`: update both target environment origin lists in one command.

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

## Hosted Dashboard Path

```env
DASHBOARD_LOCAL_PATH=/absolute/path/to/site/public
DASHBOARD_ENDPOINT=urthreads
```

Configure and build the static dashboard once:

```bash
urthreads dashboard set ./public urthreads
```

This writes the two values above to `.env`, copies the dashboard files to `./public/urthreads/`, and copies the package assets to `./public/assets/`. After upgrading `urthreads`, refresh the same hosted dashboard from the saved path:

```bash
urthreads dashboard build
```

If those values are not set yet, `urthreads dashboard build` prompts for them, saves them to `.env`, and then builds the dashboard.
If the chosen static output path does not exist, the command asks before creating it.

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
urthreads admin-session --ttl 30m --toml ./wrangler.toml
```

`ADMIN_SESSION_TTL_SECONDS` is clamped between 900 and 3600 seconds by the Worker. The command updates `.env`, updates `wrangler.toml` when available, and offers to deploy the Worker so the new lifetime takes effect.

### Email Encryption At Rest

```env
DATA_ENCRYPTION_KEY=
```

When `DATA_ENCRYPTION_KEY` is set (a 32-byte base64 string), the Worker encrypts `author_email` values with AES-GCM before storing them in D1. Encrypted values are prefixed with `enc:` and decrypted transparently when listed via the admin API. Generate a key with:

```bash
openssl rand -base64 32
```

Set it as a Worker secret:

```bash
wrangler secret put DATA_ENCRYPTION_KEY
```

Leaving `DATA_ENCRYPTION_KEY` unset means emails are stored in plaintext — this is backward compatible with existing deployments. Existing plaintext emails are returned unchanged by the admin API until they are re-saved (e.g., via a new comment).

The session cookie is `__Host-urthreads_admin_session`, set with `HttpOnly`, `Secure`, and `Path=/`. `SameSite` is automatic (`Lax` for same-origin use, `None` for cross-origin dashboards) or controlled by `ADMIN_SESSION_COOKIE_SAMESITE`.

## Optional Runtime Values

```env
MAX_COMMENTS_PER_POST=100
ADMIN_SESSION_COOKIE_SAMESITE=
```

`MAX_COMMENTS_PER_POST` controls how many approved comments the public endpoint returns for a post. The Worker reads it as a runtime variable and validates it as a positive integer; when unset or invalid it falls back to `100`.

`ADMIN_SESSION_COOKIE_SAMESITE` optionally overrides the admin session cookie's `SameSite` attribute. Accepts `Lax`, `Strict`, or `None`. When unset the Worker chooses automatically: `Lax` for same-origin dashboard use and `None` for cross-origin dashboard requests. Automatic `SameSite=None` is safe because the Worker enforces an unconditional CSRF origin check on every admin mutation, so a cross-site page cannot drive moderation actions even when the browser attaches the session cookie.

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

- `clean` is the recommended everyday reset. It removes caches, local working files, and configured hosted dashboard files while keeping your D1 database and configuration files.
- `clean-all` is the recommended full setup reset. It removes caches, working files, configured hosted dashboard files, `.env`, `wrangler.toml`, and `.dev.vars`, and asks whether to delete the deployed Worker first. Dashboard cleanup removes copied urthreads files only; it leaves directories and unrelated site files in place.
- `clean-cache` removes local cache directories such as `.wrangler`, `.mf`, and `node_modules/.cache`.
- `clean-files` removes generated local environment files such as `.env`, `wrangler.toml`, and `.dev.vars`. Add `--cache` to include caches too.
- `clean-env` removes `.env` and `wrangler.toml`, and asks whether to delete the deployed Worker first.
- When a Worker is being deleted, the CLI also asks whether to delete the inferred D1 database. Pass `--delete-database` only when you intentionally want to remove stored likes, comments, and moderation data. Pass `--database <name>` if the database name cannot be inferred.
- `delete-worker` runs `wrangler delete` only after a warning and confirmation, then recommends cleaning local environment, cache, dashboard files, and working files that refer to the deleted Worker. Pass `--name <worker>` if the Worker name cannot be inferred from `wrangler.toml` or `.env`, or `--keep-local` if you intentionally want to leave local setup files in place.

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

- Set exact `ALLOWED_ORIGINS` and confirm no `*` remains: the CLI refuses wildcards and the Worker rejects wildcard CORS on `/admin/*`.
- Add the dashboard origin if you host `web/index.html`, such as `https://www.myblog.com` for `https://www.myblog.com/urthreads/`.
- Confirm the SameSite/CSRF posture: the session cookie uses `SameSite=None` for cross-origin dashboards, which is safe because the Worker rejects admin mutations whose `Origin` is not allowed with `403` before validating credentials. This also blocks CORS-safelisted `text/plain` cross-site POSTs.
- Serve the dashboard over HTTPS only; the dashboard accepts plain `http://` worker origins only for `localhost`, `127.0.0.1`, and `[::1]` development.
- Set `ADMIN_API_KEY` as a Worker secret, give it a finite expiry, and rotate it periodically (`urthreads admin-key --expires 30d`).
- Set D1 bindings correctly in `wrangler.toml`.
- Initialize `src/schema.sql` (the Worker also creates the `auth_attempts` rate-limit table at runtime if it is missing).
- Deploy with `wrangler deploy`.
- Test `/likes?path=/test`.
- Open the dashboard over HTTPS and create a session.
- Review audit logs regularly, including failed-login attempts (5 failures per IP per 15 minutes triggers `429` + `Retry-After`).

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
