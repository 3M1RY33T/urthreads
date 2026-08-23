/**
 * Unit tests for the pure security helpers extracted to src/worker-security.mjs.
 *
 * Covers the Phase 1 security contract: CORS policy (including wildcard
 * suppression on /admin/*), session sign/verify/forgery/expiry with
 * deterministic now injection, cookie flags (__Host-, Secure, HttpOnly,
 * Path=/), CSRF allow/deny/missing-Origin, the failed-login rate limiter
 * (failures-only counting, window expiry, reset), CF-Connecting-IP-only client
 * IP resolution, and sanitized 500 bodies carrying a correlation id.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCorsHeaders,
  isAdminRequestPath,
  isAdminMutation,
  checkCsrf,
  getClientIp,
  createAdminRateLimiter,
  buildAdminSessionCookie,
  buildExpiredAdminSessionCookie,
  getAdminSessionCookieSameSite,
  getAdminSessionCookie,
  signAdminSessionPayload,
  createAdminSessionToken,
  verifyAdminSessionToken,
  fingerprintCredential,
  getAdminCredential,
  getAdminAccess,
  timingSafeEqualString,
  buildSafeErrorResponse,
  base64UrlEncodeString,
  base64UrlDecodeToString,
} from '../src/worker-security.mjs';

const WORKER_URL = 'https://worker.example.workers.dev';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function baseEnv(overrides = {}) {
  return {
    ALLOWED_ORIGINS: 'https://dashboard.example.com',
    ADMIN_API_KEY: 'test-key-123',
    ADMIN_SESSION_SECRET: 'test-secret-123',
    ADMIN_SESSION_TTL_SECONDS: '1800',
    ...overrides,
  };
}

function req(path, { method = 'GET', headers = {}, body } = {}) {
  return new Request(WORKER_URL + path, { method, headers, body });
}

function headerValue(result, name) {
  if (result == null) return undefined;
  if (typeof result.get === 'function') return result.get(name);
  return result[name];
}

function parseSetCookie(value) {
  const attrs = {};
  const parts = value.split(';').map((part) => part.trim());
  const [name, ...rest] = parts[0].split('=');
  attrs.name = name;
  attrs.value = rest.join('=');
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=');
    if (eq === -1) {
      attrs[part.toLowerCase()] = true;
    } else {
      attrs[part.slice(0, eq).trim().toLowerCase()] = part.slice(eq + 1).trim();
    }
  }
  return attrs;
}

function sameSiteOf(cookie) {
  const parsed = parseSetCookie(cookie);
  return parsed.samesite ? parsed.samesite.toLowerCase() : undefined;
}

// --- CORS policy ------------------------------------------------------------

test('getCorsHeaders: exact-origin match returns ACAO + credentials', () => {
  const request = req('/admin/session', {
    headers: { Origin: 'https://dashboard.example.com' },
  });
  const result = getCorsHeaders(request, baseEnv());
  assert.equal(headerValue(result, 'Access-Control-Allow-Origin'), 'https://dashboard.example.com');
  assert.equal(headerValue(result, 'Access-Control-Allow-Credentials'), 'true');
});

test('getCorsHeaders: second origin in comma-separated allowlist matches', () => {
  const request = req('/admin/session', {
    headers: { Origin: 'https://b.example.com' },
  });
  const result = getCorsHeaders(
    request,
    baseEnv({ ALLOWED_ORIGINS: 'https://a.example.com, https://b.example.com' })
  );
  assert.equal(headerValue(result, 'Access-Control-Allow-Origin'), 'https://b.example.com');
  assert.equal(headerValue(result, 'Access-Control-Allow-Credentials'), 'true');
});

test('getCorsHeaders: wildcard is suppressed on admin routes', () => {
  const request = req('/admin/session', {
    headers: { Origin: 'https://evil.example' },
  });
  const result = getCorsHeaders(request, baseEnv({ ALLOWED_ORIGINS: '*' }));
  const acao = headerValue(result, 'Access-Control-Allow-Origin');
  assert.notEqual(acao, '*', 'admin routes must never echo ACAO: *');
  assert.equal(acao, undefined, 'admin routes with wildcard-only config emit no ACAO at all');
});

test('getCorsHeaders: wildcard still allowed on public routes', () => {
  const request = req('/likes', { headers: { Origin: 'https://evil.example' } });
  const result = getCorsHeaders(request, baseEnv({ ALLOWED_ORIGINS: '*' }));
  assert.equal(headerValue(result, 'Access-Control-Allow-Origin'), '*');
});

test('getCorsHeaders: non-matching origin gets no ACAO', () => {
  const request = req('/admin/session', { headers: { Origin: 'https://evil.example' } });
  const result = getCorsHeaders(request, baseEnv());
  assert.equal(headerValue(result, 'Access-Control-Allow-Origin'), undefined);
});

test('getCorsHeaders: no Origin header gets no ACAO', () => {
  const result = getCorsHeaders(req('/admin/session'), baseEnv());
  assert.equal(headerValue(result, 'Access-Control-Allow-Origin'), undefined);
});

// --- Admin path / mutation classification -----------------------------------

test('isAdminRequestPath: admin paths are recognized', () => {
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/admin/session')), true);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/admin/comments/approve')), true);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/admin/comment-settings')), true);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/admin/audit-logs')), true);
});

test('isAdminRequestPath: bare /admin and non-admin paths are not', () => {
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/admin')), false);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/adminx')), false);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/likes')), false);
  assert.equal(isAdminRequestPath(new URL('https://worker.example.workers.dev/comments')), false);
});

test('isAdminMutation: mutation methods on admin paths', () => {
  assert.equal(isAdminMutation(req('/admin/session', { method: 'POST' }), new URL(WORKER_URL + '/admin/session')), true);
  assert.equal(isAdminMutation(req('/admin/session', { method: 'DELETE' }), new URL(WORKER_URL + '/admin/session')), true);
  assert.equal(isAdminMutation(req('/admin/comment-settings', { method: 'POST' }), new URL(WORKER_URL + '/admin/comment-settings')), true);
  assert.equal(isAdminMutation(req('/admin/comment-settings', { method: 'PUT' }), new URL(WORKER_URL + '/admin/comment-settings')), true);
  assert.equal(isAdminMutation(req('/admin/comments/approve', { method: 'POST' }), new URL(WORKER_URL + '/admin/comments/approve')), true);
  assert.equal(isAdminMutation(req('/admin/comments/reject', { method: 'POST' }), new URL(WORKER_URL + '/admin/comments/reject')), true);
  assert.equal(isAdminMutation(req('/admin/comments/hide', { method: 'POST' }), new URL(WORKER_URL + '/admin/comments/hide')), true);
  assert.equal(isAdminMutation(req('/admin/comments/unhide', { method: 'POST' }), new URL(WORKER_URL + '/admin/comments/unhide')), true);
  assert.equal(isAdminMutation(req('/admin/comments/delete', { method: 'POST' }), new URL(WORKER_URL + '/admin/comments/delete')), true);
});

test('isAdminMutation: reads, preflights and non-admin posts are not mutations', () => {
  assert.equal(isAdminMutation(req('/admin/session'), new URL(WORKER_URL + '/admin/session')), false);
  assert.equal(isAdminMutation(req('/admin/session', { method: 'OPTIONS' }), new URL(WORKER_URL + '/admin/session')), false);
  assert.equal(isAdminMutation(req('/likes', { method: 'POST' }), new URL(WORKER_URL + '/likes')), false);
});

// --- CSRF -------------------------------------------------------------------

test('checkCsrf: denies a cross-origin mutation', () => {
  const request = req('/admin/comments/approve', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'text/plain' },
    body: '{"id":1}',
  });
  const result = checkCsrf(request, baseEnv());
  assert.equal(result.allowed, false);
  assert.equal(typeof result.reason, 'string');
  assert.ok(result.reason.length > 0);
});

test('checkCsrf: allows an allowlisted origin', () => {
  const request = req('/admin/comments/approve', {
    method: 'POST',
    headers: { Origin: 'https://dashboard.example.com', 'Content-Type': 'text/plain' },
    body: '{"id":1}',
  });
  const result = checkCsrf(request, baseEnv());
  assert.equal(result.allowed, true);
});

test('checkCsrf: missing Origin is allowed (non-browser clients keep working)', () => {
  const request = req('/admin/comments/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: '{"id":1}',
  });
  const result = checkCsrf(request, baseEnv());
  assert.equal(result.allowed, true);
});

test('checkCsrf: the worker own-origin is always allowed', () => {
  const request = req('/admin/comments/approve', {
    method: 'POST',
    headers: { Origin: 'https://worker.example.workers.dev', 'Content-Type': 'text/plain' },
    body: '{"id":1}',
  });
  const result = checkCsrf(request, baseEnv());
  assert.equal(result.allowed, true);
});

test('checkCsrf: a wildcard-only configuration cannot satisfy CSRF', () => {
  const request = req('/admin/session', {
    method: 'POST',
    headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
    body: '{}',
  });
  const result = checkCsrf(request, baseEnv({ ALLOWED_ORIGINS: '*' }));
  assert.equal(result.allowed, false);
});

// --- Client IP --------------------------------------------------------------

test('getClientIp: trusts CF-Connecting-IP only', () => {
  const request = req('/admin/session', {
    headers: { 'CF-Connecting-IP': '203.0.113.7', 'X-Forwarded-For': '1.2.3.4' },
  });
  assert.equal(getClientIp(request), '203.0.113.7');
});

test('getClientIp: X-Forwarded-For is never trusted', () => {
  const request = req('/admin/session', { headers: { 'X-Forwarded-For': '6.6.6.6' } });
  const ip = getClientIp(request);
  assert.notEqual(ip, '6.6.6.6');
  assert.ok(ip === 'local' || ip === 'unknown');
});

test('getClientIp: loopback hosts map to local', () => {
  const request = new Request('http://localhost:8787/admin/session');
  assert.equal(getClientIp(request), 'local');
});

test('getClientIp: missing headers on remote hosts map to unknown', () => {
  assert.ok(getClientIp(req('/admin/session')) === 'local' || getClientIp(req('/admin/session')) === 'unknown');
});

// --- Rate limiter -----------------------------------------------------------

test('createAdminRateLimiter: blocks after maxFailures and reports Retry-After seconds', () => {
  const limiter = createAdminRateLimiter({ maxFailures: 5, windowMs: 15 * 60 * 1000 });
  assert.equal(limiter.isBlocked('203.0.113.7'), false);

  let result;
  for (let i = 0; i < 4; i += 1) {
    result = limiter.recordFailure('203.0.113.7');
    assert.equal(result.blocked, false, `failure ${i + 1} must not block yet`);
  }

  result = limiter.recordFailure('203.0.113.7');
  assert.equal(result.blocked, true, '5th failure must block');
  assert.equal(typeof result.retryAfterSeconds, 'number');
  assert.ok(result.retryAfterSeconds > 0);
  assert.equal(limiter.isBlocked('203.0.113.7'), true);
});

test('createAdminRateLimiter: reset clears the block', () => {
  const limiter = createAdminRateLimiter({ maxFailures: 2, windowMs: 60_000 });
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  assert.equal(limiter.isBlocked('k'), true);
  limiter.reset('k');
  assert.equal(limiter.isBlocked('k'), false);
  assert.equal(limiter.recordFailure('k').blocked, false);
});

test('createAdminRateLimiter: keys are independent', () => {
  const limiter = createAdminRateLimiter({ maxFailures: 2, windowMs: 60_000 });
  limiter.recordFailure('a');
  limiter.recordFailure('a');
  assert.equal(limiter.isBlocked('a'), true);
  assert.equal(limiter.isBlocked('b'), false);
});

test('createAdminRateLimiter: window expiry clears the block with an injected clock', () => {
  let now = 1_000_000;
  const limiter = createAdminRateLimiter({
    maxFailures: 3,
    windowMs: 60_000,
    now: () => now,
  });
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  limiter.recordFailure('k');
  assert.equal(limiter.isBlocked('k'), true);

  now += 60_001;
  assert.equal(limiter.isBlocked('k'), false);
  assert.equal(limiter.recordFailure('k').blocked, false);
});

test('createAdminRateLimiter: default options are usable', () => {
  const limiter = createAdminRateLimiter();
  const result = limiter.recordFailure('k');
  assert.equal(typeof result.blocked, 'boolean');
  assert.equal(typeof result.retryAfterSeconds, 'number');
  assert.equal(limiter.isBlocked('other-key'), false);
});

// --- Session cookies --------------------------------------------------------

test('buildAdminSessionCookie: __Host- prefix, Secure, HttpOnly, Path=/, Max-Age', () => {
  const cookie = buildAdminSessionCookie(req('/admin/session'), 'tok-123', 1800, baseEnv());
  const attrs = parseSetCookie(cookie);
  assert.equal(attrs.name, '__Host-urthreads_admin_session');
  assert.equal(attrs.value, 'tok-123');
  assert.equal(attrs.path, '/');
  assert.equal(attrs.httponly, true);
  assert.equal(attrs.secure, true);
  assert.equal(attrs['max-age'], '1800');
});

test('buildAdminSessionCookie: SameSite is Lax same-origin, None cross-origin', () => {
  const sameOrigin = buildAdminSessionCookie(req('/admin/session'), 't', 1800, baseEnv());
  assert.equal(sameSiteOf(sameOrigin), 'lax');

  const crossOrigin = buildAdminSessionCookie(
    req('/admin/session', { headers: { Origin: 'https://dashboard.example.com' } }),
    't',
    1800,
    baseEnv()
  );
  assert.equal(sameSiteOf(crossOrigin), 'none');
});

test('buildAdminSessionCookie: ADMIN_SESSION_COOKIE_SAMESITE override wins', () => {
  const cookie = buildAdminSessionCookie(
    req('/admin/session', { headers: { Origin: 'https://dashboard.example.com' } }),
    't',
    1800,
    baseEnv({ ADMIN_SESSION_COOKIE_SAMESITE: 'strict' })
  );
  assert.equal(sameSiteOf(cookie), 'strict');
});

test('buildExpiredAdminSessionCookie: clears the session cookie', () => {
  const cookie = buildExpiredAdminSessionCookie(req('/admin/session'), baseEnv());
  const attrs = parseSetCookie(cookie);
  assert.equal(attrs.name, '__Host-urthreads_admin_session');
  assert.equal(attrs.path, '/');
  assert.ok(attrs['max-age'] === '0' || attrs.expires !== undefined, 'expired cookie must carry Max-Age=0 or Expires');
});

test('getAdminSessionCookieSameSite: auto lax/none and override', () => {
  assert.equal(getAdminSessionCookieSameSite(req('/admin/session'), baseEnv()).toLowerCase(), 'lax');
  assert.equal(
    getAdminSessionCookieSameSite(req('/admin/session', { headers: { Origin: 'https://dashboard.example.com' } }), baseEnv()).toLowerCase(),
    'none'
  );
  assert.equal(
    getAdminSessionCookieSameSite(
      req('/admin/session', { headers: { Origin: 'https://dashboard.example.com' } }),
      baseEnv({ ADMIN_SESSION_COOKIE_SAMESITE: 'strict' })
    ).toLowerCase(),
    'strict'
  );
});

test('getAdminSessionCookie: extracts the session cookie value', () => {
  assert.equal(
    getAdminSessionCookie(req('/admin/session', { headers: { Cookie: '__Host-urthreads_admin_session=abc123' } })),
    'abc123'
  );
  assert.equal(
    getAdminSessionCookie(req('/admin/session', { headers: { Cookie: 'other=1; __Host-urthreads_admin_session=xyz789' } })),
    'xyz789'
  );
});

test('getAdminSessionCookie: returns falsy when absent', () => {
  assert.ok(!getAdminSessionCookie(req('/admin/session')));
  assert.ok(!getAdminSessionCookie(req('/admin/session', { headers: { Cookie: 'other=1' } })));
});

// --- Session tokens ---------------------------------------------------------

test('sign/verify session token roundtrip with deterministic now', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const keyFingerprint = await fingerprintCredential(env.ADMIN_API_KEY);
  const payload = {
    type: 'admin_session',
    iat: 1_700_000_000,
    exp: 1_700_001_800,
    jti: 'unit-jti',
    key: keyFingerprint,
  };
  const encoded = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await signAdminSessionPayload(encoded, env);
  const token = `${encoded}.${signature}`;

  const verified = await verifyAdminSessionToken(token, env, now);
  assert.equal(verified.allowed, true);
  assert.ok(verified.fingerprint.length > 0);
});

test('forged session token is rejected', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const keyFingerprint = await fingerprintCredential(env.ADMIN_API_KEY);
  const payload = { type: 'admin_session', iat: 1_700_000_000, exp: 1_700_001_800, jti: 'unit-jti', key: keyFingerprint };
  const encoded = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await signAdminSessionPayload(encoded, env);
  const token = `${encoded}.${signature}`;

  const forged = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
  assert.notEqual(forged, token);
  const verified = await verifyAdminSessionToken(forged, env, now);
  assert.equal(verified.allowed, false);
});

test('expired session token is rejected', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const keyFingerprint = await fingerprintCredential(env.ADMIN_API_KEY);
  const payload = { type: 'admin_session', iat: 1_700_000_000, exp: 1_700_001_800, jti: 'unit-jti', key: keyFingerprint };
  const encoded = base64UrlEncodeString(JSON.stringify(payload));
  const signature = await signAdminSessionPayload(encoded, env);
  const token = `${encoded}.${signature}`;

  const verified = await verifyAdminSessionToken(token, env, now + 1_805_000);
  assert.equal(verified.allowed, false);
});

test('malformed session token is rejected without throwing', async () => {
  const env = baseEnv();
  const verified = await verifyAdminSessionToken('not-a-token', env, 1_700_000_000_000);
  assert.equal(verified.allowed, false);
});

test('session token signed with a different secret is rejected', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const otherEnv = baseEnv({ ADMIN_SESSION_SECRET: 'other-secret' });
  const created = await createAdminSessionToken(otherEnv, now);
  const verified = await verifyAdminSessionToken(created.token, env, now);
  assert.equal(verified.allowed, false);
});

test('createAdminSessionToken: valid within TTL, expired after, TTL from env', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const created = await createAdminSessionToken(env, now);
  assert.equal(typeof created.token, 'string');
  assert.ok(created.token.length > 0);
  assert.equal(created.ttlSeconds, 1800);
  assert.equal(typeof created.expiresAt, 'string');

  const within = await verifyAdminSessionToken(created.token, env, now + 1000);
  assert.equal(within.allowed, true, 'token must verify within its TTL');

  const expired = await verifyAdminSessionToken(created.token, env, now + 1_805_000);
  assert.equal(expired.allowed, false, 'token must fail after its TTL');
});

test('createAdminSessionToken: TTL is clamped to the configured maximum', async () => {
  const env = baseEnv({ ADMIN_SESSION_TTL_SECONDS: '7200' });
  const created = await createAdminSessionToken(env, 1_700_000_000_000);
  assert.equal(created.ttlSeconds, 3600);
});

test('admin key expiry is enforced through session verification and key access', async () => {
  const expiredEnv = baseEnv({ ADMIN_API_KEY_EXPIRES_AT: '1970-01-01T00:00:00.000Z' });
  const now = 1_700_000_000_000;

  const created = await createAdminSessionToken(expiredEnv, now);
  const sessionVerified = await verifyAdminSessionToken(created.token, expiredEnv, now);
  assert.equal(sessionVerified.allowed, false, 'sessions must be rejected once the admin key is expired');

  const keyAccess = await getAdminAccess(
    req('/admin/session', { headers: { Authorization: 'Bearer test-key-123' } }),
    expiredEnv
  );
  assert.equal(keyAccess.allowed, false, 'key access must be rejected once the admin key is expired');
});

test('admin key with no expiry configured is never expired', async () => {
  const created = await createAdminSessionToken(baseEnv(), 1_700_000_000_000);
  const verified = await verifyAdminSessionToken(created.token, baseEnv(), 1_700_000_000_000 + 1000);
  assert.equal(verified.allowed, true);
});

// --- Credential extraction and access --------------------------------------

test('fingerprintCredential: deterministic, distinct, not reversible-looking', async () => {
  const a1 = await fingerprintCredential('secret-value');
  const a2 = await fingerprintCredential('secret-value');
  const b = await fingerprintCredential('other-value');
  assert.equal(a1, a2);
  assert.notEqual(a1, b);
  assert.notEqual(a1, 'secret-value');
  assert.match(a1, /^[0-9a-f]{16}$/);
});

test('getAdminCredential: reads Bearer Authorization and X-Admin-Key headers', () => {
  const bearer = req('/admin/session', {
    method: 'POST',
    headers: { Authorization: 'Bearer key-from-header' },
    body: '{}',
  });
  assert.equal(getAdminCredential(bearer), 'key-from-header');

  const headerToken = req('/admin/session', { headers: { 'X-Admin-Key': 'key-from-x-header' } });
  assert.equal(getAdminCredential(headerToken), 'key-from-x-header');
});

test('getAdminCredential: returns falsy when no credential header is present', () => {
  const bodyOnly = req('/admin/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminKey: 'body-only' }),
  });
  assert.ok(!getAdminCredential(bodyOnly));
  assert.ok(!getAdminCredential(req('/admin/session')));
});

test('getAdminAccess: valid session cookie grants access', async () => {
  const env = baseEnv();
  const created = await createAdminSessionToken(env, Date.now());
  const request = req('/admin/session', {
    headers: { Cookie: `__Host-urthreads_admin_session=${created.token}` },
  });
  const access = await getAdminAccess(request, env);
  assert.equal(access.allowed, true);
});

test('getAdminAccess: expired session cookie is denied', async () => {
  const env = baseEnv();
  const created = await createAdminSessionToken(env, Date.now() - 2_000_000);
  const request = req('/admin/session', {
    headers: { Cookie: `__Host-urthreads_admin_session=${created.token}` },
  });
  const access = await getAdminAccess(request, env);
  assert.equal(access.allowed, false);
});

test('getAdminAccess: valid Authorization key grants access', async () => {
  const env = baseEnv();
  const request = req('/admin/session', { headers: { Authorization: 'Bearer test-key-123' } });
  const access = await getAdminAccess(request, env);
  assert.equal(access.allowed, true);
});

test('getAdminAccess: wrong key and missing credentials are denied', async () => {
  const env = baseEnv();
  const wrong = await getAdminAccess(req('/admin/session', { headers: { Authorization: 'Bearer wrong-key' } }), env);
  assert.equal(wrong.allowed, false);
  const none = await getAdminAccess(req('/admin/session'), env);
  assert.equal(none.allowed, false);
});

test('timingSafeEqualString: equality and inequality', () => {
  assert.equal(timingSafeEqualString('abc', 'abc'), true);
  assert.equal(timingSafeEqualString('abc', 'abd'), false);
  assert.equal(timingSafeEqualString('abc', 'abcdef'), false);
  assert.equal(timingSafeEqualString('', 'a'), false);
});

// --- Sanitized error responses ---------------------------------------------

test('buildSafeErrorResponse: generic message + correlation id, no leak', () => {
  const error = new Error('ENGINE_LEAK: password=supersecret');
  const result = buildSafeErrorResponse(error);
  assert.equal(result.error, 'Engagement service failed.');
  assert.ok(!result.error.includes('ENGINE_LEAK'));
  assert.ok(!result.error.includes('supersecret'));
  assert.match(result.correlationId, UUID_RE);
});

test('buildSafeErrorResponse: error without a message still yields a safe body', () => {
  const result = buildSafeErrorResponse(new Error());
  assert.equal(result.error, 'Engagement service failed.');
  assert.match(result.correlationId, UUID_RE);
});

// --- Phase 2: crypto-safe fallbacks and jti propagation ---------------------

test('createAdminSessionToken: fallback session ID is a long base64url string, not short Math.random', async () => {
  // Force the fallback path by temporarily removing randomUUID.
  const originalRandomUUID = globalThis.crypto?.randomUUID;
  if (originalRandomUUID) {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
  try {
    const env = baseEnv();
    const now = 1_700_000_000_000;
    const created = await createAdminSessionToken(env, now);
    // The token's payload (before the dot) should decode to a jti that is
    // a long base64url string (at least 16 bytes -> ~22 chars), not a short
    // Math.random().toString(36) output.
    const encodedPayload = created.token.split('.')[0];
    const payload = JSON.parse(base64UrlDecodeToString(encodedPayload));
    assert.ok(payload.jti.length >= 20, `fallback jti must be a long string, got: ${payload.jti}`);
    // Must contain the issuedAt prefix and a base64url segment.
    assert.ok(payload.jti.startsWith('1700000000-'), `fallback jti must start with issuedAt prefix, got: ${payload.jti}`);
  } finally {
    if (originalRandomUUID) {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: originalRandomUUID,
        configurable: true,
        writable: true,
      });
    }
  }
});

test('buildSafeErrorResponse: fallback correlation ID is a long base64url string', () => {
  const originalRandomUUID = globalThis.crypto?.randomUUID;
  if (originalRandomUUID) {
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      value: undefined,
      configurable: true,
      writable: true,
    });
  }
  try {
    const result = buildSafeErrorResponse(new Error('test'));
    // The fallback correlation ID format is: timestamp-base64url(16 bytes).
    // The base64url portion should be at least ~22 chars, so the whole thing
    // is much longer than a Math.random().toString(36) output (~10-12 chars).
    assert.ok(result.correlationId.length > 30, `fallback correlationId must be long, got: ${result.correlationId}`);
    // Must not match the short Math.random pattern (timestamp followed by
    // a short alphanumeric string).
    assert.ok(!/^\d+-[a-z0-9]{1,15}$/i.test(result.correlationId),
      `fallback correlationId must not look like Math.random output, got: ${result.correlationId}`);
  } finally {
    if (originalRandomUUID) {
      Object.defineProperty(globalThis.crypto, 'randomUUID', {
        value: originalRandomUUID,
        configurable: true,
        writable: true,
      });
    }
  }
});

test('createAdminSessionToken: returns jti in the result object', async () => {
  const env = baseEnv();
  const created = await createAdminSessionToken(env, 1_700_000_000_000);
  assert.ok(created.jti, 'createAdminSessionToken must return a jti property');
  assert.equal(typeof created.jti, 'string');
  assert.ok(created.jti.length > 0);
});

test('verifyAdminSessionToken: returns jti on successful verification', async () => {
  const env = baseEnv();
  const now = 1_700_000_000_000;
  const created = await createAdminSessionToken(env, now);
  const verified = await verifyAdminSessionToken(created.token, env, now + 1000);
  assert.equal(verified.allowed, true);
  assert.ok(verified.jti, 'verifyAdminSessionToken must return jti on success');
  assert.equal(verified.jti, created.jti);
});
