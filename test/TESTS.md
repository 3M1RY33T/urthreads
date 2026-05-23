| [Overview](../README.md) | [Dashboard](../web/DASHBOARD.md) | [Configuration And Environment](../config/CONFIGURATION_AND_ENVIRONMENT.md) | [Program Logic](../src/PROGRAM_LOGIC.md) | *> Tests <* |
| --- | --- | --- | --- | --- |

# Tests

This directory contains Node's built-in test runner coverage for the CLI and setup helpers.

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
- `env-config.test.js`: allowed origin merging, wildcard removal, sensitive output hiding, and `.env` opening behavior.
- `setup-env.test.js`: Worker URL normalization, endpoint generation, origin list cleanup, and `.env` generation.
- `thread-cf.test.js`: top-level command routing and help output.
- `wrangler-config.test.js`: `wrangler.toml` generation, value updates, listing, and CLI routing.

## What The Tests Emphasize

The tests focus on code that can be verified locally without a Cloudflare account:

- SQL generation is escaped and structured correctly.
- CLI commands route to the expected modules.
- `.env` updates preserve unrelated values.
- `wrangler.toml` updates target the correct local, staging, or production section.
- Sensitive values are not printed when they should remain hidden.
- Allowed origins are exact and wildcard values are removed when real origins are added.
- Setup output derives endpoint URLs from the Worker URL.

Worker runtime behavior is mostly exercised through focused helper tests and syntax checks. End-to-end Worker behavior still needs Wrangler/D1 integration testing because it depends on Cloudflare's runtime bindings.

## Useful Local Checks

Syntax check important entrypoints:

```bash
node --check src/worker.js
node --check src/thread-cf.js
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
