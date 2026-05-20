const assert = require("assert");
const { spawnSync } = require("child_process");
const path = require("path");
const { test } = require("node:test");
const {
  MODERATION_COMMANDS,
  README_SYNC_COMMANDS,
  SETUP_COMMANDS,
} = require("../src/cflc");

const cflcPath = path.join(__dirname, "..", "src", "cflc.js");

function runCflc(args) {
  return spawnSync(process.execPath, [cflcPath, ...args], {
    encoding: "utf8",
  });
}

test("exposes setup and moderation command groups", () => {
  assert.strictEqual(SETUP_COMMANDS.has("setup-env"), true);
  assert.strictEqual(SETUP_COMMANDS.has("init"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("pending"), true);
  assert.strictEqual(MODERATION_COMMANDS.has("approve"), true);
  assert.strictEqual(README_SYNC_COMMANDS.has("sync-readme-comments"), true);
});

test("prints top-level help", () => {
  const result = runCflc(["--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("cflc - Cloudflare Likes & Comments"));
  assert.ok(result.stdout.includes("setup-env"));
  assert.ok(result.stdout.includes("approve <id>"));
  assert.ok(result.stdout.includes("sync-readme-comments"));
});

test("routes setup help through cflc", () => {
  const result = runCflc(["setup-env", "--help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Cloudflare Likes & Comments .env Setup"));
  assert.ok(result.stdout.includes("cflc setup-env"));
});

test("routes comment management help through cflc", () => {
  const result = runCflc(["comments", "help"]);

  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout.includes("Comment Management Tool"));
  assert.ok(result.stdout.includes("cflc comments approve 5"));
});
