/**
 * Unit tests for src/setup-dev.js (npm run setup:dev).
 *
 * All file operations use temporary directories under os.tmpdir() so the real
 * wrangler.toml and .dev.vars in the repo are never touched.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const {
  parseD1DatabaseName,
  readD1DatabaseName,
  prepareDevVarsContent,
  readDevVars,
  validateAdminKeyExpiry,
  main,
} = require("../src/setup-dev");

const SAMPLE_WRANGLER = [
  'name = "test-worker"',
  'main = "src/worker.js"',
  "",
  "[[d1_databases]]",
  'binding = "DB"',
  'database_name = "test"',
  'database_id = "7b9efd96-b82a-4815-ae12-4c78985adf82"',
  "",
  "[env.production]",
  'name = "test-worker-prod"',
  "",
  "[[env.production.d1_databases]]",
  'binding = "DB"',
  'database_name = "test-prod"',
  "",
  "[vars]",
  'ALLOWED_ORIGINS = "http://localhost:8000"',
  "",
].join("\n");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `urthreads-setup-dev-${prefix}-`));
}

test('parseD1DatabaseName: reads the top-level d1 database_name, ignoring per-env blocks', () => {
  assert.equal(parseD1DatabaseName(SAMPLE_WRANGLER), "test");
  assert.equal(parseD1DatabaseName('[[d1_databases]]\ndatabase_name = "my-db"\n'), "my-db");
  assert.equal(parseD1DatabaseName("name = \"x\"\n"), "", "no d1 block yields empty");
  assert.equal(parseD1DatabaseName('only [[env.staging.d1_databases]]\ndatabase_name = "s"\n'), "");
});

test('readD1DatabaseName: throws a helpful error when wrangler.toml is missing or lacks a binding', () => {
  const dir = tempDir("missing");
  const missing = path.join(dir, "wrangler.toml");
  assert.throws(() => readD1DatabaseName(missing), /setup:env/);

  const noBinding = path.join(dir, "wrangler.toml");
  fs.writeFileSync(noBinding, 'name = "x"\n');
  assert.throws(() => readD1DatabaseName(noBinding), /setup:env/);
});

test('prepareDevVarsContent: writes a key and empty expiry when .dev.vars is absent', () => {
  const content = prepareDevVarsContent("", "new-key-123").content;
  const values = readDevVars(content);
  assert.equal(values.ADMIN_API_KEY, "new-key-123");
  assert.equal(values.ADMIN_API_KEY_EXPIRES_AT, "");
});

test('prepareDevVarsContent: reuses an existing key and overwrites a stale expiry to empty', () => {
  const existing = [
    "ADMIN_API_KEY=existing-key",
    "ADMIN_API_KEY_EXPIRES_AT=2020-01-01T00:00:00.000Z",
    "OTHER=keep-me",
  ].join("\n");

  const prepared = prepareDevVarsContent(existing, "existing-key");
  const values = readDevVars(prepared.content);

  assert.equal(prepared.reusedKey, true, "the existing key must be reused, not regenerated");
  assert.equal(prepared.overwroteExpiry, true, "a stale expiry must be flagged as overwritten");
  assert.equal(values.ADMIN_API_KEY, "existing-key");
  assert.equal(values.ADMIN_API_KEY_EXPIRES_AT, "", "stale expiry must be reset to empty");
  assert.ok(prepared.expiredWarning.length > 0, "a warning is printed when a stale expiry is overwritten");
  assert.equal(readDevVars(prepared.content).OTHER, "keep-me", "unrelated lines are preserved");
});

test('prepareDevVarsContent: no stale expiry means no overwrite warning', () => {
  const prepared = prepareDevVarsContent("ADMIN_API_KEY=abc\nADMIN_API_KEY_EXPIRES_AT=\n", "abc");
  assert.equal(prepared.overwroteExpiry, false);
  assert.equal(prepared.expiredWarning, "");
});

test('validateAdminKeyExpiry: empty/never/none are not expired; unparseable and past are expired (fail-closed)', () => {
  assert.deepStrictEqual(validateAdminKeyExpiry(""), { ok: true, expired: false, message: "" });
  assert.deepStrictEqual(validateAdminKeyExpiry("never"), { ok: true, expired: false, message: "" });
  assert.deepStrictEqual(validateAdminKeyExpiry("None"), { ok: true, expired: false, message: "" });

  const unparseable = validateAdminKeyExpiry("garbage");
  assert.equal(unparseable.ok, false);
  assert.equal(unparseable.expired, true);

  const past = validateAdminKeyExpiry("2020-01-01T00:00:00.000Z", Date.parse("2026-01-01T00:00:00.000Z"));
  assert.equal(past.expired, true, "a past date must be expired");
});

test('main: writes a new .dev.vars with a generated key + empty expiry and runs the local schema', () => {
  const dir = tempDir("main");
  fs.writeFileSync(path.join(dir, "wrangler.toml"), SAMPLE_WRANGLER);
  const devVarsPath = path.join(dir, ".dev.vars");
  let stdout = "";
  const schemaCommands = [];

  const result = main([], {
    output: { write: (chunk) => { stdout += chunk; } },
    generateAdminApiKey: () => "generated-key-abc",
    copyToClipboard: () => ({ copied: true, command: "test-clipboard" }),
    exec: (command) => { schemaCommands.push(command); },
    wranglerPath: path.join(dir, "wrangler.toml"),
    cwd: dir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.adminKey, "generated-key-abc");
  assert.equal(result.databaseName, "test");
  assert.equal(result.reusedKey, false);

  assert.ok(fs.existsSync(devVarsPath), '.dev.vars must be written in cwd');
  const values = readDevVars(fs.readFileSync(devVarsPath, "utf8"));
  assert.equal(values.ADMIN_API_KEY, "generated-key-abc");
  assert.equal(values.ADMIN_API_KEY_EXPIRES_AT, "");

  assert.deepStrictEqual(schemaCommands, ["npx wrangler d1 execute test --local --file=src/schema.sql"]);
  assert.ok(stdout.includes("npm run dev"), "next steps must mention npm run dev");
});

test('main: reuses an existing key and overwrites a stale expiry in .dev.vars', () => {
  const dir = tempDir("main-existing");
  fs.writeFileSync(path.join(dir, "wrangler.toml"), SAMPLE_WRANGLER);
  fs.writeFileSync(path.join(dir, ".dev.vars"), "ADMIN_API_KEY=existing-key\nADMIN_API_KEY_EXPIRES_AT=2020-01-01T00:00:00.000Z\n");
  let stdout = "";

  const result = main([], {
    output: { write: (chunk) => { stdout += chunk; } },
    generateAdminApiKey: () => "should-not-be-used",
    copyToClipboard: () => ({ copied: false, command: "" }),
    exec: () => {},
    wranglerPath: path.join(dir, "wrangler.toml"),
    cwd: dir,
  });

  assert.equal(result.ok, true);
  assert.equal(result.reusedKey, true, "existing key must be reused");
  const values = readDevVars(fs.readFileSync(path.join(dir, ".dev.vars"), "utf8"));
  assert.equal(values.ADMIN_API_KEY, "existing-key");
  assert.equal(values.ADMIN_API_KEY_EXPIRES_AT, "", "stale expiry must be reset to empty");
  assert.ok(stdout.includes("Reused the existing ADMIN_API_KEY"));
});

test('main: missing D1 binding -> clean error, no .dev.vars written', () => {
  const dir = tempDir("main-nodb");
  fs.writeFileSync(path.join(dir, "wrangler.toml"), 'name = "x"\n');
  let stdout = "";

  const result = main([], {
    output: { write: (chunk) => { stdout += chunk; } },
    generateAdminApiKey: () => "key",
    copyToClipboard: () => ({ copied: false, command: "" }),
    exec: () => {},
    wranglerPath: path.join(dir, "wrangler.toml"),
    cwd: dir,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, "no_d1_database");
  assert.ok(stdout.includes("setup:env"));
  assert.ok(!fs.existsSync(path.join(dir, ".dev.vars")), ".dev.vars must not be created without a D1 binding");
});
