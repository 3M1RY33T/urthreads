const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const { test } = require("node:test");
const {
  ADMIN_KEY_COMMANDS,
  ADMIN_SESSION_COMMANDS,
  BACKOUT_COMMANDS,
  ENV_COMMANDS,
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
  WRANGLER_COMMANDS,
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
  assert.strictEqual(BACKOUT_COMMANDS.has("clean"), true);
  assert.strictEqual(BACKOUT_COMMANDS.has("clean-all"), true);
  assert.strictEqual(BACKOUT_COMMANDS.has("clean-env"), true);
  assert.strictEqual(BACKOUT_COMMANDS.has("delete-worker"), true);
  assert.strictEqual(ENV_COMMANDS.has("env"), true);
  assert.strictEqual(ENV_COMMANDS.has("origins"), true);
  assert.strictEqual(WRANGLER_COMMANDS.has("wrangler-init"), true);
  assert.strictEqual(WRANGLER_COMMANDS.has("wrangler"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("pending"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("approve"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("create-comment"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("set-like"), true);
});

test("prints top-level help", () => {
  const result = runThreadCf(["--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("urthreads - self-hosted static-site engagement"));
  assert.ok(result.stdout.includes("setup-env"));
  assert.ok(result.stdout.includes("wrangler-init"));
  assert.ok(result.stdout.includes("env add-origin"));
  assert.ok(result.stdout.includes("admin-key"));
  assert.ok(result.stdout.includes("admin-session"));
  assert.ok(result.stdout.includes("clean"));
  assert.ok(result.stdout.includes("clean-all"));
  assert.ok(result.stdout.includes("clean-env"));
  assert.ok(result.stdout.includes("delete-worker"));
  assert.ok(result.stdout.includes("approve <id>"));
  assert.ok(result.stdout.includes("set-like <path> <n>"));
});

test("routes setup help through urthreads", () => {
  const result = runThreadCf(["setup-env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("urthreads .env Setup"));
  assert.ok(result.stdout.includes("urthreads setup-env"));
});

test("routes env help through urthreads", () => {
  const result = runThreadCf(["env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Environment Config"));
  assert.ok(result.stdout.includes("urthreads env"));
});

test("routes wrangler help through urthreads", () => {
  const result = runThreadCf(["wrangler", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Wrangler Config"));
  assert.ok(result.stdout.includes("urthreads wrangler"));
});

test("routes admin key help through urthreads", () => {
  const result = runThreadCf(["admin-key", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Key Generator"));
  assert.ok(result.stdout.includes("urthreads admin-key"));
});

test("routes admin session help through urthreads", () => {
  const result = runThreadCf(["admin-session", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Session Config"));
  assert.ok(result.stdout.includes("urthreads admin-session"));
});

test("routes back-out help through urthreads", () => {
  const result = runThreadCf(["backout", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Back-Out Commands"));
  assert.ok(result.stdout.includes("urthreads backout"));
});

test("routes comment management help through urthreads", () => {
  const result = runThreadCf(["comments", "help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Comment Management Tool"));
  assert.ok(result.stdout.includes("approve <id>"));
});
