const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const { test } = require("node:test");
const {
  ADMIN_KEY_COMMANDS,
  ADMIN_SESSION_COMMANDS,
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
} = require("../src/thread-cf");

const threadCfPath = path.join(__dirname, "..", "src", "thread-cf.js");

function runThreadCf(args) {
  return spawnSync(process.execPath, [threadCfPath, ...args], {
    encoding: "utf8",
  });
}

test("exposes setup and moderation command groups", () => {
  assert.strictEqual(SETUP_COMMANDS.has("setup-env"), true);
  assert.strictEqual(SETUP_COMMANDS.has("init"), true);
  assert.strictEqual(ADMIN_KEY_COMMANDS.has("admin-key"), true);
  assert.strictEqual(ADMIN_KEY_COMMANDS.has("rotate-admin-key"), true);
  assert.strictEqual(ADMIN_SESSION_COMMANDS.has("admin-session"), true);
  assert.strictEqual(ADMIN_SESSION_COMMANDS.has("session-ttl"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("pending"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("approve"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("create-comment"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("set-like"), true);
});

test("prints top-level help", () => {
  const result = runThreadCf(["--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("thread-cf - Cloudflare Likes & Comments"));
  assert.ok(result.stdout.includes("setup-env"));
  assert.ok(result.stdout.includes("admin-key"));
  assert.ok(result.stdout.includes("admin-session"));
  assert.ok(result.stdout.includes("approve <id>"));
  assert.ok(result.stdout.includes("set-like <path> <n>"));
});

test("routes setup help through thread-cf", () => {
  const result = runThreadCf(["setup-env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Cloudflare Likes & Comments .env Setup"));
  assert.ok(result.stdout.includes("thread-cf setup-env"));
});

test("routes admin key help through thread-cf", () => {
  const result = runThreadCf(["admin-key", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Key Generator"));
  assert.ok(result.stdout.includes("thread-cf admin-key"));
});

test("routes admin session help through thread-cf", () => {
  const result = runThreadCf(["admin-session", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Session Config"));
  assert.ok(result.stdout.includes("thread-cf admin-session"));
});

test("routes comment management help through thread-cf", () => {
  const result = runThreadCf(["comments", "help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Comment Management Tool"));
  assert.ok(result.stdout.includes("thread-cf comments approve 5"));
});
