const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  generateAdminApiKey,
  main,
  parseArgs,
  parseExpirationValue,
  upsertEnvVars,
  writeEnvFile,
} = require("../src/admin-key");

test("generates a URL-safe admin API key", () => {
  const key = generateAdminApiKey();

  assert.strictEqual(typeof key, "string");
  assert.ok(key.length >= 40);
  assert.match(key, /^[A-Za-z0-9_-]+$/);
});

test("parses never and duration expiration values", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");

  assert.deepStrictEqual(parseExpirationValue("never", now), {
    expiresAt: "",
    label: "never",
  });

  assert.strictEqual(
    parseExpirationValue("30d", now).expiresAt,
    "2026-06-19T12:00:00.000Z"
  );
});

test("rejects past expiration values", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");

  assert.throws(
    () => parseExpirationValue("2026-05-19T12:00:00.000Z", now),
    /future/
  );
});

test("upserts admin key values while preserving unrelated env lines", () => {
  const content = [
    "CLOUDFLARE_ACCOUNT_ID=account",
    "ADMIN_API_KEY=old-key",
    "ADMIN_API_KEY=duplicate-key",
    "D1_DATABASE_NAME=likes-and-comments",
    "",
  ].join("\n");

  const updated = upsertEnvVars(content, {
    ADMIN_API_KEY: "new-key",
    ADMIN_API_KEY_EXPIRES_AT: "2026-06-19T12:00:00.000Z",
  });

  assert.ok(updated.includes("CLOUDFLARE_ACCOUNT_ID=account"));
  assert.ok(updated.includes("D1_DATABASE_NAME=likes-and-comments"));
  assert.strictEqual((updated.match(/^ADMIN_API_KEY=/gm) || []).length, 1);
  assert.ok(updated.includes("ADMIN_API_KEY=new-key"));
  assert.ok(updated.includes("ADMIN_API_KEY_EXPIRES_AT=2026-06-19T12:00:00.000Z"));
});

test("writes a new env file when one does not exist", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-cf-admin-key-"));
  const envPath = path.join(tmpDir, ".env");

  writeEnvFile(envPath, {
    ADMIN_API_KEY: "new-key",
    ADMIN_API_KEY_EXPIRES_AT: "",
  });

  const content = fs.readFileSync(envPath, "utf8");
  assert.ok(content.includes("# Admin dashboard"));
  assert.ok(content.includes("ADMIN_API_KEY=new-key"));
  assert.ok(content.includes("ADMIN_API_KEY_EXPIRES_AT="));
});

test("parses admin key CLI flags", () => {
  const args = parseArgs(["--env", ".env.local", "--expires=90d"]);

  assert.strictEqual(args.envPath, ".env.local");
  assert.strictEqual(args.expires, "90d");
});

test("does not print generated admin key and copies it to clipboard", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "thread-cf-admin-key-output-"));
  const envPath = path.join(tmpDir, ".env");
  const generatedKey = "secret-admin-key-value";
  let clipboardValue = "";
  let stdout = "";

  await main(["--env", envPath, "--expires", "never"], {
    output: { write: (chunk) => { stdout += chunk; } },
    prompter: null,
    generateAdminApiKey: () => generatedKey,
    copyToClipboard: (value) => {
      clipboardValue = value;
      return { copied: true, command: "test-clipboard" };
    },
  });

  const content = fs.readFileSync(envPath, "utf8");
  assert.ok(content.includes(`ADMIN_API_KEY=${generatedKey}`));
  assert.strictEqual(clipboardValue, generatedKey);
  assert.ok(stdout.includes("Copied ADMIN_API_KEY to your clipboard."));
  assert.ok(!stdout.includes(generatedKey));
});
