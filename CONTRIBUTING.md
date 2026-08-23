# Contributing

Thank you for considering a contribution to `urthreads`.

This project is a self-hosted Cloudflare Worker, D1 schema, browser client, CLI, and static admin dashboard for adding likes and comments to static sites.

## Ways To Contribute

- Report bugs with clear reproduction steps.
- Improve setup, dashboard, CLI, or Worker documentation.
- Add focused tests for CLI helpers, configuration handling, and Worker behavior that can be exercised locally.
- Improve examples for common static-site hosts and frameworks.
- Propose production hardening improvements, especially around moderation, CORS, sessions, and D1 operations.

## Development Setup

Clone the repository and install dependencies:

```bash
npm install
```

Run the local setup helper if you need a `.env`:

```bash
npm run setup:env
```

Run tests and syntax checks before opening a pull request:

```bash
npm test
npm run check
```

For local Worker + dashboard development (no Cloudflare account needed):

```bash
npm install
npm run setup:dev    # creates .dev.vars (admin key, never-expiring), initializes local D1
npm run dev          # wrangler dev on http://localhost:8787
```

Open a second terminal for the static dashboard/example server:

```bash
python3 -m http.server 8000
```

Then open:

```text
http://localhost:8000/web/index.html
```

Or the multi-page example pointed at the local Worker:

```text
http://localhost:8000/examples/multi-page-test/index.html?worker=http://localhost:8787
```

`npm run setup:dev` prints the admin key to paste into the dashboard when it prompts. `ALLOWED_ORIGINS` already includes `http://localhost:8000` (see `wrangler.toml`), so the cookie session works locally without extra config.

## Pull Request Guidelines

- Keep pull requests focused on one behavior or documentation area.
- Preserve existing public `data-*` attributes, CLI command names, and environment variable names unless the change is intentionally breaking.
- Add or update tests when changing CLI parsing, configuration generation, SQL generation, moderation behavior, or dashboard data handling.
- Avoid committing secrets, generated `.env` files, real Cloudflare API tokens, or real admin keys.
- Update `README.md` or the relevant docs file when changing setup, deployment, dashboard, or contribution workflows.

### Branch protection (recommended)

For repositories using this workflow:
- Require the `test` and `security-scan` CI checks to pass before merging to `main` and `dev`.
- Require at least one review before merging to `main`.
- These are recommendations for individually maintained repos; enable them in GitHub Settings → Branches → Branch protection rules.

## Testing Guidance

Prefer tests that run locally without a Cloudflare account. Use Node's built-in test runner:

```bash
node --test
```

For file-writing tests, use temporary directories under `os.tmpdir()` and avoid modifying repository-local configuration files.

End-to-end Worker tests may require `wrangler`, a D1 database, and explicit environment setup. Keep those tests opt-in unless they can run reliably in a clean local environment.

## Security Contributions

Do not open public issues for suspected vulnerabilities. Follow [SECURITY.md](./SECURITY.md) instead.

## License

By contributing, you agree that your contribution will be licensed under the repository's GPL-3.0-only license.
