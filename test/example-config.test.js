const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  buildExampleWorkerConfigContent,
  normalizeWorkerUrl,
  writeExampleWorkerConfig,
} = require("../src/example-config");

test("builds browser-safe example Worker config", () => {
  const content = buildExampleWorkerConfigContent("https://worker.example.dev/");

  assert.ok(content.includes('const defaultWorkerUrl = "https://worker.example.dev";'));
  assert.ok(content.includes('const storageKey = `urthreads:example:worker:${defaultWorkerUrl || "default"}`;'));
  assert.ok(content.includes('params.get("worker")'));
  assert.ok(content.includes('params.get("resetWorker")'));
  assert.ok(content.includes("window.URTHREADS_WORKER = workerUrl;"));
  assert.ok(content.includes("window.LIKES_CONFIG.endpoint"));
  assert.ok(content.includes("window.COMMENTS_CONFIG.endpoint"));
});

test("writes example Worker config to examples directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-example-config-"));
  const configPath = writeExampleWorkerConfig("https://worker.example.dev/", {
    cwd: tempDir,
  });

  assert.strictEqual(path.relative(tempDir, configPath), path.join("examples", "urthreads-worker-config.js"));
  assert.ok(fs.readFileSync(configPath, "utf8").includes("https://worker.example.dev"));
});

test("normalizes Worker URL for generated example config", () => {
  assert.strictEqual(normalizeWorkerUrl("https://worker.example.dev///"), "https://worker.example.dev");
});

test("committed example config defaults to the local Worker", () => {
  const configPath = path.join(__dirname, "..", "examples", "urthreads-worker-config.js");
  const content = fs.readFileSync(configPath, "utf8");

  assert.ok(
    content.includes('const defaultWorkerUrl = "http://localhost:8787";'),
    "example default must be the local Worker so the dashboard and example share one target"
  );
  assert.ok(content.includes('params.get("worker")'));
  assert.ok(content.includes('params.get("resetWorker")'));
});
