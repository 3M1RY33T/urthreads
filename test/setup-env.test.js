const assert = require("assert");
const { test } = require("node:test");
const {
  buildEndpointUrl,
  buildEnvContent,
  normalizeUrl,
  sanitizeOriginList,
} = require("../src/setup-env");

test("normalizes worker URLs by trimming trailing slashes", () => {
  assert.strictEqual(
    normalizeUrl("https://example.workers.dev///"),
    "https://example.workers.dev"
  );
});

test("builds endpoint URLs from worker URL and endpoint path", () => {
  assert.strictEqual(
    buildEndpointUrl("https://example.workers.dev/", "likes"),
    "https://example.workers.dev/likes"
  );
  assert.strictEqual(
    buildEndpointUrl("https://example.workers.dev/", "/comments"),
    "https://example.workers.dev/comments"
  );
});

test("sanitizes comma-separated origin lists", () => {
  assert.strictEqual(
    sanitizeOriginList(" https://a.test, ,https://b.test "),
    "https://a.test,https://b.test"
  );
});

test("builds env content with derived client endpoints", () => {
  const content = buildEnvContent({
    accountId: "account",
    apiToken: "token",
    databaseName: "db",
    databaseId: "db-id",
    workerName: "worker",
    workerUrl: "https://worker.example.workers.dev/",
    allowedOrigins: "https://example.com",
    allowedOriginsStaging: "http://localhost:8787",
    allowedOriginsProd: "https://example.com",
    maxCommentsPerPost: "50",
  });

  assert.ok(content.includes("CLOUDFLARE_ACCOUNT_ID=account"));
  assert.ok(content.includes("D1_DATABASE_NAME=db"));
  assert.ok(content.includes("LIKES_ENDPOINT=https://worker.example.workers.dev/likes"));
  assert.ok(content.includes("COMMENTS_ENDPOINT=https://worker.example.workers.dev/comments"));
  assert.ok(content.includes("ALLOWED_ORIGINS_PROD=https://example.com"));
  assert.ok(content.includes("MAX_COMMENTS_PER_POST=50"));
});
