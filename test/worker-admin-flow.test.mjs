/**
 * End-to-end admin-flow tests against the worker's default-export fetch
 * handler (src/worker.js) with a mocked env.DB.
 *
 * Covers the Phase 1 behavior that the pure-helper unit tests cannot: the
 * session POST/DELETE/GET flow, the 401 gate on /admin/*, audit-log INSERTs
 * (admin_audit_logs), the /admin/worker secret-leak guarantee, the CSRF 403 on
 * a cross-origin text/plain mutation (a CORS-safelisted "simple request" that
 * never preflights), and sanitized 500s with a correlation id.
 *
 * The rate limiter is module-level in worker.js and shared across requests, so
 * each test uses a distinct CF-Connecting-IP to keep the buckets independent.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import worker from '../src/worker.js';

const WORKER_URL = 'https://worker.example.workers.dev';
const ADMIN_API_KEY = 'test-key-123';
const ADMIN_SESSION_SECRET = 'test-secret-456';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * Recording mock D1 in the pinned shape:
 *   prepare(sql) -> { bind(...args) -> { run(), all(), first() } }, batch(stmts)
 * run() resolves { meta }; all() resolves { results: [] }; first() resolves a
 * permissive admin_sessions row (for the optional revocation flow) or null.
 * Every run is captured so tests can assert audit INSERTs and auth_attempts
 * UPSERTs.
 */
function createMockD1() {
  const auditInserts = [];
  const authAttemptWrites = [];
  const statements = [];

  function makeStatement(sql) {
    const execute = (kind, args) => {
      statements.push({ sql, kind, args });
      if (kind === 'run') {
        if (/admin_audit_logs/i.test(sql)) auditInserts.push(args);
        if (/auth_attempts/i.test(sql)) authAttemptWrites.push(args);
        return { meta: { last_row_id: statements.length, affected_rows: 1 } };
      }
      if (kind === 'first' && /admin_sessions/i.test(sql)) {
        return { id: 1, revoked_at: null, expires_at: '2999999999999' };
      }
      if (kind === 'first') return null;
      return { results: [] };
    };

    const bound = (args) => ({
      async run() {
        return execute('run', args);
      },
      async all() {
        return execute('all', args);
      },
      async first() {
        return execute('first', args);
      },
    });

    return {
      bind(...args) {
        return bound(args);
      },
      async run() {
        return execute('run', []);
      },
      async all() {
        return execute('all', []);
      },
      async first() {
        return execute('first', []);
      },
    };
  }

  return {
    prepare(sql) {
      return makeStatement(sql);
    },
    async batch(stmts) {
      const results = [];
      for (const statement of stmts) {
        if (typeof statement.run === 'function') results.push(await statement.run());
        else results.push({ meta: { affected_rows: 1 } });
      }
      return results;
    },
    auditInserts,
    authAttemptWrites,
    statements,
  };
}

function makeEnv(db, overrides = {}) {
  return {
    DB: db,
    ALLOWED_ORIGINS: 'https://dashboard.example.com',
    ADMIN_API_KEY,
    ADMIN_SESSION_SECRET,
    ADMIN_SESSION_TTL_SECONDS: '1800',
    MAX_COMMENTS_PER_POST: '100',
    WORKER_NAME: 't',
    ...overrides,
  };
}

function auditAction(db, action) {
  return db.auditInserts.find((args) => args[0] === action);
}

function login(env, { adminKey = ADMIN_API_KEY, ip = '203.0.113.10' } = {}) {
  return worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://dashboard.example.com',
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify({ adminKey }),
    }),
    env
  );
}

function sessionCookieHeader(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'expected a Set-Cookie header on the response');
  const parsed = parseSetCookie(cookie);
  return `${parsed.name}=${parsed.value}`;
}

test('admin-flow: GET /admin/session without credentials -> 401 { authenticated: false }', async () => {
  const env = makeEnv(createMockD1());
  const res = await worker.fetch(new Request(WORKER_URL + '/admin/session'), env);
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.authenticated, false);
});

test('admin-flow: POST valid adminKey -> 200 with __Host- cookie flags and audit row', async () => {
  const db = createMockD1();
  const env = makeEnv(db);
  const res = await login(env, { ip: '203.0.113.10' });
  assert.equal(res.status, 200);

  const body = await res.json();
  assert.equal(body.authenticated, true);
  assert.equal(typeof body.expiresAt, 'string');
  assert.equal(body.ttlSeconds, 1800);

  const cookie = res.headers.get('set-cookie');
  assert.ok(cookie, 'Set-Cookie expected on successful login');
  const attrs = parseSetCookie(cookie);
  assert.equal(attrs.name, '__Host-urthreads_admin_session');
  assert.ok(attrs.value.length > 0, 'cookie must carry a session token');
  assert.equal(attrs.path, '/');
  assert.equal(attrs.httponly, true);
  assert.equal(attrs.secure, true);
  assert.ok(attrs.samesite, 'SameSite attribute must be present');

  assert.ok(auditAction(db, 'admin.session.create'), 'successful login must be audit-logged');
});

test('admin-flow: GET /admin/session with a valid session cookie -> 200 { authenticated: true }', async () => {
  const env = makeEnv(createMockD1());
  const loginRes = await login(env, { ip: '203.0.113.15' });
  assert.equal(loginRes.status, 200);

  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      headers: {
        Cookie: sessionCookieHeader(loginRes),
        Origin: 'https://dashboard.example.com',
      },
    }),
    env
  );
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.authenticated, true);
});

test('admin-flow: failed logins are counted and rate-limited with Retry-After', async () => {
  const db = createMockD1();
  const env = makeEnv(db);
  const ip = '198.51.100.7';

  // The worker blocks from the attempt AFTER the 5th recorded failure: the
  // crossing request returns 401 (and records the failure), the next one 429.
  for (let i = 1; i <= 5; i += 1) {
    const res = await login(env, { adminKey: 'wrong-key', ip });
    assert.equal(res.status, 401, `failed attempt ${i} must return 401`);
  }

  const blocked = await login(env, { adminKey: 'wrong-key', ip });
  assert.equal(blocked.status, 429, 'a request after 5 failed logins must be rate-limited');
  assert.ok(blocked.headers.get('retry-after'), '429 must include Retry-After');

  const stillBlocked = await login(env, { adminKey: 'wrong-key', ip });
  assert.equal(stillBlocked.status, 429, 'subsequent attempts stay blocked');

  assert.ok(auditAction(db, 'admin.session.create_failed'), 'failed logins must be audit-logged');
  assert.ok(auditAction(db, 'admin.session.rate_limited'), 'rate-limited logins must be audit-logged');
  assert.ok(
    db.authAttemptWrites.some((args) => args.length > 0),
    'failed logins must persist auth_attempts rows (durable D1 boundary)'
  );
});

test('admin-flow: DELETE /admin/session clears the session cookie', async () => {
  const env = makeEnv(createMockD1());
  const loginRes = await login(env, { ip: '203.0.113.20' });
  assert.equal(loginRes.status, 200);

  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      method: 'DELETE',
      headers: {
        Cookie: sessionCookieHeader(loginRes),
        Origin: 'https://dashboard.example.com',
      },
    }),
    env
  );
  assert.equal(res.status, 200);

  const attrs = parseSetCookie(res.headers.get('set-cookie'));
  assert.equal(attrs.name, '__Host-urthreads_admin_session');
  assert.equal(attrs.path, '/');
  assert.ok(attrs['max-age'] === '0' || attrs.expires !== undefined, 'logout must expire the session cookie');
});

test('admin-flow: CSRF blocks a cross-origin text/plain mutation, allowed origin proceeds to auth', async () => {
  const env = makeEnv(createMockD1());
  const url = WORKER_URL + '/admin/comments/approve';

  // Content-Type: text/plain is a CORS-safelisted "simple request" — no
  // preflight fires, so only the Origin check can stop it.
  const evil = await worker.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'text/plain',
        'CF-Connecting-IP': '203.0.113.30',
      },
      body: '{"id":1}',
    }),
    env
  );
  assert.equal(evil.status, 403, 'cross-origin mutation must be CSRF-rejected');
  assert.equal(evil.headers.get('set-cookie'), null, 'CSRF rejection must not set cookies');
  const evilText = await evil.text();
  if (evilText) {
    const evilBody = JSON.parse(evilText);
    assert.equal(typeof evilBody.error, 'string');
    assert.ok(evilBody.error.length > 0);
  }

  const allowed = await worker.fetch(
    new Request(url, {
      method: 'POST',
      headers: {
        Origin: 'https://dashboard.example.com',
        'Content-Type': 'text/plain',
        'CF-Connecting-IP': '203.0.113.30',
      },
      body: '{"id":1}',
    }),
    env
  );
  assert.equal(allowed.status, 401, 'allowed-origin request must proceed to auth and fail without credentials');
});

test('admin-flow: missing Origin on a mutation is not CSRF-blocked (curl-style clients)', async () => {
  const env = makeEnv(createMockD1());
  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/comments/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.40' },
      body: '{"id":1}',
    }),
    env
  );
  assert.equal(res.status, 401, 'missing Origin must proceed to auth, not 403');
});

test('admin-flow: CSRF-rejected logins do not count toward the rate limit', async () => {
  const env = makeEnv(createMockD1());
  const ip = '198.51.100.90';

  for (let i = 0; i < 5; i += 1) {
    const res = await worker.fetch(
      new Request(WORKER_URL + '/admin/session', {
        method: 'POST',
        headers: {
          Origin: 'https://evil.example',
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
        },
        body: JSON.stringify({ adminKey: 'wrong-key' }),
      }),
      env
    );
    assert.equal(res.status, 403, `CSRF must reject attempt ${i + 1} before rate limiting`);
  }

  const legit = await login(env, { adminKey: 'wrong-key', ip });
  assert.equal(legit.status, 401, 'legitimate-origin login must not be rate-limited by CSRF-rejected attempts');
});

test('admin-flow: /admin/worker never leaks admin secrets', async () => {
  const env = makeEnv(createMockD1());
  const loginRes = await login(env, { ip: '203.0.113.50' });
  assert.equal(loginRes.status, 200);

  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/worker', {
      headers: {
        Cookie: sessionCookieHeader(loginRes),
        Origin: 'https://dashboard.example.com',
      },
    }),
    env
  );
  assert.equal(res.status, 200);
  const text = await res.text();
  for (const needle of [ADMIN_API_KEY, ADMIN_SESSION_SECRET, 'ADMIN_API_KEY', 'ADMIN_SESSION_SECRET']) {
    assert.ok(!text.includes(needle), `response must not leak ${needle}`);
  }
});

test('admin-flow: a handler throw yields a sanitized 500 with a correlation id', async () => {
  const db = createMockD1();
  const originalPrepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    if (/comments/i.test(sql)) {
      throw new Error('ENGINE_LEAK: secret=xyz');
    }
    return originalPrepare(sql);
  };
  const env = makeEnv(db);

  const loginRes = await login(env, { ip: '203.0.113.60' });
  assert.equal(loginRes.status, 200);

  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/comments/approve', {
      method: 'POST',
      headers: {
        Origin: 'https://dashboard.example.com',
        'Content-Type': 'text/plain',
        Cookie: sessionCookieHeader(loginRes),
      },
      body: '{"id":1}',
    }),
    env
  );
  assert.equal(res.status, 500);

  const body = await res.json();
  assert.equal(body.error, 'Engagement service failed.');
  assert.match(body.correlationId, UUID_RE);
  assert.ok(!JSON.stringify(body).includes('ENGINE_LEAK'));
  assert.ok(!JSON.stringify(body).includes('secret=xyz'));

  assert.ok(auditAction(db, 'admin.error'), 'admin 500s must be audit-logged with the correlation id');
});
