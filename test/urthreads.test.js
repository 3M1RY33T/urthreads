const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const { test } = require("node:test");
const {
  ADMIN_KEY_COMMANDS,
  ADMIN_SESSION_COMMANDS,
  BACKOUT_COMMANDS,
  DASHBOARD_COMMANDS,
  ENV_COMMANDS,
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
  WRANGLER_COMMANDS,
} = require("../src/urthreads");

const urthreadsPath = path.join(__dirname, "..", "src", "urthreads.js");

function runUrthreads(args) {
  return spawnSync(process.execPath, [urthreadsPath, ...args], {
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
  assert.strictEqual(DASHBOARD_COMMANDS.has("dashboard"), true);
  assert.strictEqual(DASHBOARD_COMMANDS.has("dashboard-build"), true);
  assert.strictEqual(ENV_COMMANDS.has("env"), true);
  assert.strictEqual(ENV_COMMANDS.has("origins"), true);
  assert.strictEqual(WRANGLER_COMMANDS.has("wrangler-init"), true);
  assert.strictEqual(WRANGLER_COMMANDS.has("wrangler"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("pending"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("approve"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("create-comment"), false);
  assert.strictEqual(MODERATION_COMMANDS.has("update-comment"), false);
  assert.strictEqual(MODERATION_COMMANDS.has("set-like"), false);
  assert.strictEqual(MODERATION_COMMANDS.has("increment-like"), false);
  assert.strictEqual(MODERATION_COMMANDS.has("delete-like"), true);
});

test("prints top-level help", () => {
  const result = runUrthreads(["--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("urthreads - self-hosted static-site engagement"));
  assert.ok(result.stdout.includes("setup-env"));
  assert.ok(result.stdout.includes("wrangler-init"));
  assert.ok(result.stdout.includes("env add-origin"));
  assert.ok(result.stdout.includes("admin-key"));
  assert.ok(result.stdout.includes("admin-session"));
  assert.ok(result.stdout.includes("dashboard"));
  assert.ok(result.stdout.includes("clean"));
  assert.ok(result.stdout.includes("clean-all"));
  assert.ok(result.stdout.includes("clean-env"));
  assert.ok(result.stdout.includes("delete-worker"));
  assert.ok(result.stdout.includes("approve <id>"));
  assert.ok(!result.stdout.includes("create-comment"));
  assert.ok(!result.stdout.includes("update-comment"));
  assert.ok(result.stdout.includes("list-likes"));
  assert.ok(!result.stdout.includes("set-like <path>"));
  assert.ok(!result.stdout.includes("increment-like"));
});

test("routes setup help through urthreads", () => {
  const result = runUrthreads(["setup-env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("urthreads .env Setup"));
  assert.ok(result.stdout.includes("urthreads setup-env"));
});

test("routes env help through urthreads", () => {
  const result = runUrthreads(["env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Environment Config"));
  assert.ok(result.stdout.includes("urthreads env"));
});

test("routes dashboard help through urthreads", () => {
  const result = runUrthreads(["dashboard", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Dashboard Builder"));
  assert.ok(result.stdout.includes("urthreads dashboard"));
});

test("routes wrangler help through urthreads", () => {
  const result = runUrthreads(["wrangler", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Wrangler Config"));
  assert.ok(result.stdout.includes("urthreads wrangler"));
});

test("routes admin key help through urthreads", () => {
  const result = runUrthreads(["admin-key", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Key Generator"));
  assert.ok(result.stdout.includes("urthreads admin-key"));
});

test("routes admin session help through urthreads", () => {
  const result = runUrthreads(["admin-session", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Admin Session Config"));
  assert.ok(result.stdout.includes("urthreads admin-session"));
});

test("routes back-out help through urthreads", () => {
  const result = runUrthreads(["backout", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Back-Out Commands"));
  assert.ok(result.stdout.includes("urthreads backout"));
});

test("routes comment management help through urthreads", () => {
  const result = runUrthreads(["comments", "help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Comment Management Tool"));
  assert.ok(result.stdout.includes("approve <id>"));
});
