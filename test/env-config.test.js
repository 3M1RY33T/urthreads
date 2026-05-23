const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  getOpenCommand,
  main,
  mergeAllowedOrigins,
  normalizeOrigin,
  parseEnvContent,
  resolveOriginKey,
} = require("../src/env-config");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "thread-cf-env-"));
}

test("normalizes exact http and https origins", () => {
  assert.strictEqual(normalizeOrigin("https://example.com/"), "https://example.com");
  assert.strictEqual(normalizeOrigin("http://localhost:8000/path"), "http://localhost:8000");
  assert.throws(() => normalizeOrigin("*"), /not '\*'/);
  assert.throws(() => normalizeOrigin("ftp://example.com"), /http or https/);
});

test("merges origins while removing wildcard and duplicates", () => {
  assert.strictEqual(
    mergeAllowedOrigins("*", ["http://localhost:8000"]),
    "http://localhost:8000"
  );
  assert.strictEqual(
    mergeAllowedOrigins("http://localhost:8000", ["http://localhost:8000", "https://example.com"]),
    "http://localhost:8000,https://example.com"
  );
});

test("resolves allowed origin targets", () => {
  assert.strictEqual(resolveOriginKey("default"), "ALLOWED_ORIGINS");
  assert.strictEqual(resolveOriginKey("staging"), "ALLOWED_ORIGINS_STAGING");
  assert.strictEqual(resolveOriginKey("prod"), "ALLOWED_ORIGINS_PROD");
});

test("adds allowed origins to env file", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, "ALLOWED_ORIGINS=*\nOTHER=value\n", "utf8");

  const writes = [];
  await main(
    ["add-origin", "http://localhost:8000", "https://example.com", "--env", envPath],
    {
      commandName: "urthreads env",
      output: { write: (message) => writes.push(message) },
    }
  );

  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  assert.strictEqual(values.ALLOWED_ORIGINS, "http://localhost:8000,https://example.com");
  assert.strictEqual(values.OTHER, "value");
  assert.ok(writes.join("").includes("ALLOWED_ORIGINS=http://localhost:8000,https://example.com"));
});

test("sets and hides sensitive env values in command output", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const writes = [];

  await main(["set", "ADMIN_API_KEY", "secret-value", "--env", envPath], {
    commandName: "urthreads env",
    output: { write: (message) => writes.push(message) },
  });

  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  assert.strictEqual(values.ADMIN_API_KEY, "secret-value");
  assert.ok(writes.join("").includes("ADMIN_API_KEY=(hidden)"));
  assert.ok(!writes.join("").includes("secret-value"));
});

test("opens env file with platform viewer", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, "ALLOWED_ORIGINS=https://example.com\n", "utf8");
  const calls = [];

  await main(["open", "--env", envPath, "--viewer", "viewer"], {
    commandName: "urthreads env",
    output: { write: () => {} },
    opener: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, [{ command: "viewer", args: [envPath] }]);
  assert.deepStrictEqual(getOpenCommand(envPath, "", "darwin"), { command: "open", args: [envPath] });
});
