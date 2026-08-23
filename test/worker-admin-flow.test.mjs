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

// ---------------------------------------------------------------------------
// Phase 3: D1-backed rate limiting on public POST endpoints
// ---------------------------------------------------------------------------
// The existing createMockD1 returns generic results for all queries. Rate
// limit tests need a mock that tracks public_rate_limits rows (window_start,
// request_count, lockout_until) per (bucket_key, endpoint) and admin_sessions
// rows (jti, revoked, expires_at) for the Phase 4 revocation tests.

/**
 * Stateful mock D1 that simulates rate limit counters and admin session rows.
 * Rate limit rows are keyed by (bucket_key, endpoint). The mock tracks the
 * latest window_start, request_count, and lockout_until for each key.
 * Admin session rows are keyed by jti with revoked and expires_at fields.
 *
 * An optional `nowFn` lets tests inject deterministic timestamps so they can
 * simulate window expiry without waiting in real time.
 */
function createStatefulMockD1(options = {}) {
  const nowFn = options.nowFn || (() => Date.now());
  const rateLimitRows = new Map(); // key: "bucket_key|endpoint" -> { window_start, request_count, lockout_until }
  const adminSessionRows = new Map(); // key: jti -> { revoked, expires_at }
  const auditInserts = [];
  const authAttemptWrites = [];
  const allStatements = [];

  function rateLimitKey(bucketKey, endpoint) {
    return `${bucketKey}|${endpoint}`;
  }

  function makeStatement(sql) {
    const execute = (kind, args) => {
      allStatements.push({ sql, kind, args });

      if (kind === 'run') {
        if (/admin_audit_logs/i.test(sql)) auditInserts.push(args);
        if (/auth_attempts/i.test(sql)) authAttemptWrites.push(args);

        // Handle public_rate_limits upsert (INSERT ... ON CONFLICT DO UPDATE)
        if (/public_rate_limits/i.test(sql)) {
          const bucketKey = args[0];
          const endpoint = args[1];
          const windowStart = args[2];
          const key = rateLimitKey(bucketKey, endpoint);

          if (/ON CONFLICT/i.test(sql)) {
            const existing = rateLimitRows.get(key);
            if (existing && existing.window_start === windowStart) {
              // ON CONFLICT DO UPDATE: increment counter or set lockout
              if (/request_count = request_count \+ 1/i.test(sql)) {
                existing.request_count += 1;
              }
              if (/lockout_until = \?/i.test(sql) && args[4] != null) {
                existing.lockout_until = args[4];
              }
              existing.updated_at = 'CURRENT_TIMESTAMP';
            } else {
              // New row
              const requestCount = args[3] != null ? args[3] : 1;
              const lockoutUntil = args[4] != null ? args[4] : null;
              rateLimitRows.set(key, {
                window_start: windowStart,
                request_count: requestCount,
                lockout_until: lockoutUntil,
              });
            }
          } else {
            // Plain INSERT (shouldn't normally happen, but handle it)
            rateLimitRows.set(key, {
              window_start: windowStart,
              request_count: args[3] || 1,
              lockout_until: args[4] || null,
            });
          }
        }

        // Handle admin_sessions operations
        if (/admin_sessions/i.test(sql)) {
          if (/INSERT/i.test(sql) && /ON CONFLICT.*DO NOTHING/i.test(sql)) {
            const jti = args[0];
            if (!adminSessionRows.has(jti)) {
              adminSessionRows.set(jti, {
                revoked: 0,
                expires_at: args[2],
              });
            }
          }
          if (/UPDATE.*SET revoked = 1/i.test(sql)) {
            const jti = args[0];
            if (adminSessionRows.has(jti)) {
              adminSessionRows.get(jti).revoked = 1;
            }
          }
          if (/DELETE FROM admin_sessions/i.test(sql)) {
            const cutoff = args[0];
            for (const [jti, row] of adminSessionRows) {
              if (row.expires_at < cutoff) {
                adminSessionRows.delete(jti);
              }
            }
          }
        }

        return { meta: { last_row_id: allStatements.length, affected_rows: 1 } };
      }

      if (kind === 'first') {
        // admin_sessions SELECT
        if (/admin_sessions/i.test(sql) && /SELECT.*revoked.*expires_at/i.test(sql)) {
          const jti = args[0];
          const row = adminSessionRows.get(jti);
          if (!row) return null;
          return { revoked: row.revoked, expires_at: String(row.expires_at) };
        }

        // public_rate_limits lockout check
        if (/public_rate_limits/i.test(sql) && /lockout_until/i.test(sql)) {
          const bucketKey = args[0];
          const endpoint = args[1];
          const key = rateLimitKey(bucketKey, endpoint);
          const row = rateLimitRows.get(key);
          if (!row || !row.lockout_until) return null;
          return { lockout_until: row.lockout_until };
        }

        // public_rate_limits window check
        if (/public_rate_limits/i.test(sql) && /window_start.*request_count/i.test(sql)) {
          const bucketKey = args[0];
          const endpoint = args[1];
          const key = rateLimitKey(bucketKey, endpoint);
          const row = rateLimitRows.get(key);
          if (!row) return null;
          return { window_start: row.window_start, request_count: row.request_count };
        }

        // post_likes / post_comments first() for like count
        if (/post_likes/i.test(sql)) {
          return { count: 0 };
        }
        if (/post_comments/i.test(sql) && /likes_count/i.test(sql)) {
          return { likes_count: 0 };
        }
        if (/post_comments/i.test(sql) && /SELECT path/i.test(sql)) {
          return { path: '/test' };
        }
        if (/post_comments/i.test(sql) && /SELECT id FROM post_comments WHERE id/i.test(sql)) {
          return { id: 1 };
        }

        return null;
      }

      if (kind === 'all') {
        // post_comments all() for getApprovedComments
        if (/post_comments/i.test(sql)) {
          return { results: [] };
        }
        return { results: [] };
      }

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
    allStatements,
    _rateLimitRows: rateLimitRows,
    _adminSessionRows: adminSessionRows,
  };
}

// --- Phase 3: Rate limiting tests ------------------------------------------

test('rate-limit: 31st like request in 60 seconds returns 429', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);
  const ip = '203.0.113.100';

  // Send 30 like POSTs — all should succeed (200).
  for (let i = 0; i < 30; i += 1) {
    const res = await worker.fetch(
      new Request(WORKER_URL + '/likes?path=/test-post', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      }),
      env
    );
    assert.equal(res.status, 200, `like request ${i + 1} must succeed`);
  }

  // The 31st request must be rate-limited (429).
  const blocked = await worker.fetch(
    new Request(WORKER_URL + '/likes?path=/test-post', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    }),
    env
  );
  assert.equal(blocked.status, 429, '31st like request must be rate-limited');
  assert.ok(blocked.headers.get('retry-after'), '429 must include Retry-After header');

  const body = await blocked.json();
  assert.ok(body.error.includes('Rate limit'), '429 body must mention rate limit');
});

test('rate-limit: 6th comment submission in 60 seconds returns 429', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);
  const ip = '203.0.113.101';
  const commentBody = JSON.stringify({
    path: '/test-post',
    pageUrl: 'https://example.com/test',
    pageTitle: 'Test',
    nickname: 'Tester',
    content: 'Test comment',
  });

  // Send 5 comment POSTs — all should succeed (201).
  for (let i = 0; i < 5; i += 1) {
    const res = await worker.fetch(
      new Request(WORKER_URL + '/comments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
        },
        body: commentBody,
      }),
      env
    );
    assert.equal(res.status, 201, `comment request ${i + 1} must succeed`);
  }

  // The 6th request must be rate-limited (429).
  const blocked = await worker.fetch(
    new Request(WORKER_URL + '/comments', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
      },
      body: commentBody,
    }),
    env
  );
  assert.equal(blocked.status, 429, '6th comment request must be rate-limited');
  assert.ok(blocked.headers.get('retry-after'), '429 must include Retry-After header');
});

test('rate-limit: rate limit resets after the window expires (injected timestamps)', async () => {
  // Use a controllable clock so we can advance past the 60-second window
  // without waiting in real time.
  let currentTime = 1_700_000_000_000;
  const db = createStatefulMockD1({ nowFn: () => currentTime });

  // Monkey-patch Date.now on the env-level functions. The worker uses
  // Date.now() internally, so we need to stub it globally for this test.
  const originalDateNow = Date.now;
  Date.now = () => currentTime;

  try {
    const env = makeEnv(db);
    const ip = '203.0.113.102';

    // Send 30 like POSTs to hit the limit.
    for (let i = 0; i < 30; i += 1) {
      const res = await worker.fetch(
        new Request(WORKER_URL + '/likes?path=/test-post', {
          method: 'POST',
          headers: { 'CF-Connecting-IP': ip },
        }),
        env
      );
      assert.equal(res.status, 200, `like request ${i + 1} must succeed`);
    }

    // 31st must be blocked.
    const blocked = await worker.fetch(
      new Request(WORKER_URL + '/likes?path=/test-post', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      }),
      env
    );
    assert.equal(blocked.status, 429, '31st like request must be rate-limited');

    // Advance time past the 60-second window.
    currentTime += 61_001;

    // After the window expires, the next request must succeed.
    const afterWindow = await worker.fetch(
      new Request(WORKER_URL + '/likes?path=/test-post', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      }),
      env
    );
    assert.equal(afterWindow.status, 200, 'request after window expiry must succeed');
  } finally {
    Date.now = originalDateNow;
  }
});

test('rate-limit: different IPs have independent rate limit buckets', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);

  // Exhaust IP A's like budget.
  for (let i = 0; i < 30; i += 1) {
    await worker.fetch(
      new Request(WORKER_URL + '/likes?path=/test-post', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': '198.51.100.1' },
      }),
      env
    );
  }

  // IP A is blocked.
  const blockedA = await worker.fetch(
    new Request(WORKER_URL + '/likes?path=/test-post', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.1' },
    }),
    env
  );
  assert.equal(blockedA.status, 429, 'IP A must be rate-limited after 30 requests');

  // IP B is unaffected.
  const okB = await worker.fetch(
    new Request(WORKER_URL + '/likes?path=/test-post', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': '198.51.100.2' },
    }),
    env
  );
  assert.equal(okB.status, 200, 'IP B must not be rate-limited by IP A usage');
});

test('rate-limit: comment_likes endpoint has its own rate limit budget', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);
  const ip = '203.0.113.103';

  // Exhaust the likes budget.
  for (let i = 0; i < 30; i += 1) {
    await worker.fetch(
      new Request(WORKER_URL + '/likes?path=/test-post', {
        method: 'POST',
        headers: { 'CF-Connecting-IP': ip },
      }),
      env
    );
  }

  // Likes are blocked.
  const blockedLikes = await worker.fetch(
    new Request(WORKER_URL + '/likes?path=/test-post', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    }),
    env
  );
  assert.equal(blockedLikes.status, 429, 'likes must be rate-limited');

  // Comment likes still work (different endpoint bucket).
  const okCommentLike = await worker.fetch(
    new Request(WORKER_URL + '/comments/like?commentId=1', {
      method: 'POST',
      headers: { 'CF-Connecting-IP': ip },
    }),
    env
  );
  assert.equal(okCommentLike.status, 200, 'comment_likes endpoint must be independent from likes');
});

// --- Phase 4: D1-backed session revocation tests ---------------------------

test('revocation: a revoked admin session is rejected', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);

  // Login to create a session.
  const loginRes = await login(env, { ip: '203.0.113.110' });
  assert.equal(loginRes.status, 200);

  // The session works.
  const cookie = sessionCookieHeader(loginRes);
  const beforeRes = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      headers: { Cookie: cookie, Origin: 'https://dashboard.example.com' },
    }),
    env
  );
  assert.equal(beforeRes.status, 200, 'session must work before revocation');

  // Revoke the session via DELETE.
  const deleteRes = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://dashboard.example.com' },
    }),
    env
  );
  assert.equal(deleteRes.status, 200, 'DELETE must succeed');

  // The same session cookie must now be rejected.
  const afterRes = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      headers: { Cookie: cookie, Origin: 'https://dashboard.example.com' },
    }),
    env
  );
  assert.equal(afterRes.status, 401, 'revoked session must be rejected');
});

test('revocation: DELETE /admin/session revokes the session in D1', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);

  // Login.
  const loginRes = await login(env, { ip: '203.0.113.111' });
  assert.equal(loginRes.status, 200);
  const cookie = sessionCookieHeader(loginRes);

  // Extract the jti from the session token to verify it was persisted.
  const tokenValue = cookie.split('=')[1];
  const encodedPayload = tokenValue.split('.')[0];

  // The token is base64url-encoded JSON. Decode it to get the jti.
  const payload = JSON.parse(
    Buffer.from(encodedPayload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
  );
  assert.ok(payload.jti, 'session token must contain a jti');

  // Verify the session was persisted in the mock D1.
  assert.ok(db._adminSessionRows.has(payload.jti), 'session must be persisted in admin_sessions table');

  // DELETE to revoke.
  const deleteRes = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: 'https://dashboard.example.com' },
    }),
    env
  );
  assert.equal(deleteRes.status, 200);

  // Verify the session is marked revoked in D1.
  const sessionRow = db._adminSessionRows.get(payload.jti);
  assert.ok(sessionRow, 'session row must exist after delete');
  assert.equal(sessionRow.revoked, 1, 'session must be marked revoked=1 in D1');
});

test('revocation: a session for a non-existent jti is rejected', async () => {
  const db = createStatefulMockD1();
  const env = makeEnv(db);

  // Create a valid session token (signed with the correct secret), but
  // do NOT persist it — the D1 admin_sessions table has no row for it.
  // The crypto signature is valid, but the jti was never persisted.
  const { createAdminSessionToken } = await import('../src/worker-security.mjs');
  const created = await createAdminSessionToken(env, Date.now());

  // The token is cryptographically valid but has no D1 row.
  const res = await worker.fetch(
    new Request(WORKER_URL + '/admin/session', {
      headers: {
        Cookie: `__Host-urthreads_admin_session=${created.token}`,
        Origin: 'https://dashboard.example.com',
      },
    }),
    env
  );
  assert.equal(res.status, 401, 'session with non-existent jti must be rejected');
});
