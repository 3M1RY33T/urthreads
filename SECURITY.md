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

- Use exact `ALLOWED_ORIGINS`; `*` is refused by the CLI and the Worker never honors wildcard CORS on `/admin/*`.
- Store `ADMIN_API_KEY` as a Worker secret; optionally set `ADMIN_SESSION_SECRET` (at least 32 bytes) so session tokens are signed independently of the admin key (the Worker falls back to `ADMIN_API_KEY` when it is unset).
- Use HTTPS for deployed dashboard and client origins; the dashboard rejects plain-http worker origins except `localhost`, `127.0.0.1`, and `[::1]` development.
- Rotate admin keys after suspected exposure and prefer a finite key expiry (`urthreads admin-key --expires 30d`).
- Admin mutations are CSRF-protected by an Origin check, and `POST /admin/session` is rate-limited to 5 failed attempts per 15 minutes per client IP (`CF-Connecting-IP`); audit logs record `CF-Connecting-IP` and never trust `X-Forwarded-For`.
- Logout revokes the session server-side in D1 (`admin_sessions`), so a logged-out session cookie cannot be replayed.
- Keep Cloudflare account, API token, and D1 permissions scoped to what the deployment needs.

## Cloudflare Rate Limiting Rules (Recommended)

The Worker implements D1-backed rate limiting for public POST endpoints as a
defense-in-depth measure. For production deployments, also configure Cloudflare
edge rate limiting rules to block abusive traffic before it reaches the Worker.
This reduces Worker CPU usage and D1 row churn from bot-driven floods.

### Recommended Rules

| Endpoint | Threshold | Window |
|---|---|---|
| `/likes` (POST) | 100 requests | 10 seconds per IP |
| `/comments/like` (POST) | 100 requests | 10 seconds per IP |
| `/comments` (POST) | 10 requests | 10 seconds per IP |

### Dashboard Configuration Steps

1. Log in to the [Cloudflare dashboard](https://dash.cloudflare.com).
2. Select your domain (or the Workers route domain).
3. Navigate to **Security > WAF > Rate limiting rules**.
4. Click **Create rule** and configure:
   - **Rule name**: `urthreads-likes-rate-limit`
   - **If incoming requests match**: Custom filter expression
     - Field: `URI Path`, Operator: `equals`, Value: `/likes`
     - AND Field: `Method`, Operator: `equals`, Value: `POST`
   - **Then take action**: Block
   - **Rate**: 100 requests per 10 seconds per IP
5. Repeat for `/comments/like` (100 requests / 10 seconds) and `/comments`
   (10 requests / 10 seconds).
6. Save and deploy each rule.

> **Note**: The Worker's D1-backed limits (30 likes/min, 30 comment likes/min,
> 5 comments/min) are stricter and serve as the application-level boundary.
> Cloudflare rules should be set higher to catch volumetric attacks early
> without interfering with legitimate users who are within the Worker limits.
