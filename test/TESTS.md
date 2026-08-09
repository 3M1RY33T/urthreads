# <img src="../assets/img/urthreads.png" alt="" width="40" height="40" align="left" style="margin-right: 20px;" /> Tests

| [Overview](../README.md) | [Dashboard](../web/DASHBOARD.md) | [Configuration And Environment](../config/CONFIGURATION_AND_ENVIRONMENT.md) | [Program Logic](../src/PROGRAM_LOGIC.md) | *> Tests <* |
| --- | --- | --- | --- | --- |

This directory contains Node's built-in test runner coverage for the CLI, setup helpers, and Worker runtime security.

Run all tests:

```bash
npm test
```

The script runs:

```bash
node --test
```

## Test Files

- `admin-key.test.js`: admin key generation, expiration parsing, `.env` updates, and clipboard-safe output.
- `admin-session.test.js`: dashboard session TTL parsing and `.env` updates.
- `cli.test.js`: moderation and D1 SQL command builders.
- `dashboard-config.test.js`: static dashboard installation, saved path config, and refresh behavior.
- `env-config.test.js`: allowed origin merging, wildcard removal, sensitive output hiding, and `.env` opening behavior.
- `example-config.test.js`: generated browser-safe Worker config for static HTML examples.
- `setup-env.test.js`: Worker URL normalization, endpoint generation, origin list cleanup, Wrangler D1 creation parsing, hidden prompts, and `.env` generation.
- `urthreads.test.js`: top-level command routing and help output.
- `wrangler-config.test.js`: `wrangler.toml` generation, value updates, listing, and CLI routing.
- `worker-security.test.mjs`: unit tests for the Worker security helpers in `src/worker-security.mjs` — CORS policy (exact-origin match plus wildcard suppression on `/admin/*`), admin session token sign/verify/forgery/expiry, cookie flags (`__Host-`, `Secure`, `HttpOnly`, `Path=/`), CSRF origin allow/deny/missing, rate-limiter counting failures only, `getClientIp` reading `CF-Connecting-IP` only, and sanitized 500 responses with correlation ids.
- `worker-admin-flow.test.mjs`: fetch-handler tests with a mocked D1 binding — admin session POST/DELETE/GET flow, the 401 gate on `/admin/*`, audit-log INSERT assertions, `/admin/worker` never leaking `ADMIN_API_KEY`/`ADMIN_SESSION_SECRET`, a `403` CSRF rejection for a cross-origin `text/plain` POST, and `429` + `Retry-After` after five failed admin keys.

## What The Tests Emphasize

The tests focus on code that can be verified locally without a Cloudflare account:

- SQL generation is escaped and structured correctly.
- CLI commands route to the expected modules.
- `.env` updates preserve unrelated values.
- `wrangler.toml` updates target the correct local, staging, or production section.
- Sensitive values are not printed when they should remain hidden.
- Allowed origins are exact and wildcard values are removed when real origins are added.
- Setup output derives endpoint URLs from the Worker URL.

Worker runtime behavior is covered by `worker-security.test.mjs` and `worker-admin-flow.test.mjs`, which drive the Worker's fetch handler against a mocked D1 binding. Wrangler/D1 integration testing against real Cloudflare runtime bindings remains a manual pre-deploy check.

## Useful Local Checks

Syntax check important entrypoints:

```bash
node --check src/worker.js
node --check src/urthreads.js
node --check src/env-config.js
node --check web/dashboard.js
```

Run a single test file:

```bash
node --test test/env-config.test.js
```

Run with more verbose output:

```bash
node --test --test-reporter spec
```

## Adding Tests

Prefer tests that:

- Avoid live network calls.
- Use temporary directories for `.env` writes.
- Assert command output does not expose secrets.
- Cover command parsing and generated Wrangler SQL before adding runtime-only checks.
- Keep destructive database actions behind generated command strings unless explicitly testing execution behavior.

For CLI tests that need file writes, use `fs.mkdtempSync()` under `os.tmpdir()` and pass `--env <temp-file>`.
