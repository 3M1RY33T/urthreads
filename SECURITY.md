# Security Policy

`urthreads` handles public engagement data, moderation actions, admin sessions, and Cloudflare Worker configuration. Please report suspected vulnerabilities privately.

## Supported Versions

Security fixes are currently handled on the `main` branch. Until the project publishes multiple maintained release lines, please assume only the latest released version and current `main` branch are supported.

## Reporting A Vulnerability

Please do not report security issues in public GitHub issues.

Report vulnerabilities by contacting the maintainer through the GitHub profile for this project:

- GitHub: https://github.com/3M1RY33T

Include as much detail as you safely can:

- Affected version, commit, or deployment context.
- Whether the issue affects the Worker, dashboard, CLI, browser client, examples, or docs.
- Reproduction steps or proof-of-concept details.
- Expected impact, such as admin session exposure, CORS bypass, unauthorized moderation, data leakage, XSS, SQL injection, or secret handling.
- Any relevant logs, request/response samples, or configuration details with secrets removed.

## Response Expectations

The maintainer will make a best effort to:

- Acknowledge valid reports promptly.
- Reproduce and assess severity.
- Prepare a fix or mitigation.
- Credit reporters when appropriate and requested.

Response timelines may vary because this is an open-source project maintained by an individual.

## Security Scope

In scope:

- Worker API authorization and admin session handling.
- CORS behavior and dashboard authentication flows.
- Comment rendering and moderation behavior that could enable XSS or unauthorized content changes.
- D1 query construction and data access controls.
- CLI or setup behavior that could expose secrets.

Out of scope:

- Vulnerabilities in Cloudflare, npm, GitHub, browsers, or other third-party services.
- Issues caused by intentionally unsafe local configuration, such as publishing real admin keys or allowing untrusted origins.
- Denial-of-service reports without a practical mitigation path for this project.

## Operational Guidance

When deploying `urthreads`:

- Use exact `ALLOWED_ORIGINS`; avoid `*` for dashboard deployments.
- Store `ADMIN_API_KEY` as a Worker secret.
- Use HTTPS for deployed dashboard and client origins.
- Rotate admin keys after suspected exposure.
- Keep Cloudflare account, API token, and D1 permissions scoped to what the deployment needs.
