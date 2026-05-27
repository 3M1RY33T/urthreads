const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  ADMIN_SESSION_TTL_SECONDS_NAME,
  parseArgs,
  parseSessionTtlValue,
  main,
} = require("../src/admin-session");
const {
  buildWranglerTomlContent,
  getWranglerValue,
} = require("../src/wrangler-config");

test("parses admin session TTL durations", () => {
  assert.strictEqual(parseSessionTtlValue("default"), 3600);
  assert.strictEqual(parseSessionTtlValue("3600"), 3600);
  assert.strictEqual(parseSessionTtlValue("15m"), 900);
  assert.strictEqual(parseSessionTtlValue("30m"), 1800);
  assert.strictEqual(parseSessionTtlValue("1h"), 3600);
});

test("rejects invalid admin session TTL durations", () => {
  assert.throws(() => parseSessionTtlValue("30s"), /between 15 minutes and 1 hour/);
  assert.throws(() => parseSessionTtlValue("2h"), /between 15 minutes and 1 hour/);
  assert.throws(() => parseSessionTtlValue("soon"), /Session TTL must be/);
});

test("parses admin session CLI flags", () => {
  const args = parseArgs(["--env", ".env.local", "--toml", "wrangler.custom.toml", "--ttl=30m"]);

  assert.strictEqual(args.envPath, ".env.local");
  assert.strictEqual(args.wranglerPath, "wrangler.custom.toml");
  assert.strictEqual(args.ttl, "30m");
});

test("writes admin session TTL to env file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-session-"));
  const envPath = path.join(tmpDir, ".env");
  fs.writeFileSync(envPath, "ADMIN_API_KEY=existing\n", "utf8");

  const output = { write() {} };
  await main(["--env", envPath, "--ttl", "30m"], { output, prompter: null });

  const content = fs.readFileSync(envPath, "utf8");
  assert.ok(content.includes("ADMIN_API_KEY=existing"));
  assert.ok(content.includes(`${ADMIN_SESSION_TTL_SECONDS_NAME}=1800`));
});

test("writes admin session TTL to env and wrangler toml", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-session-wrangler-"));
  const envPath = path.join(tmpDir, ".env");
  const wranglerPath = path.join(tmpDir, "wrangler.toml");
  fs.writeFileSync(envPath, "ADMIN_API_KEY=existing\n", "utf8");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({
    adminSessionTtlSeconds: "3600",
  }), "utf8");
  const writes = [];

  await main(["--env", envPath, "--toml", wranglerPath, "--ttl", "30m"], {
    output: { write: (message) => writes.push(message) },
    prompter: null,
  });

  const envContent = fs.readFileSync(envPath, "utf8");
  const wranglerContent = fs.readFileSync(wranglerPath, "utf8");
  assert.ok(envContent.includes(`${ADMIN_SESSION_TTL_SECONDS_NAME}=1800`));
  assert.strictEqual(getWranglerValue(wranglerContent, ADMIN_SESSION_TTL_SECONDS_NAME), "1800");
  assert.strictEqual(getWranglerValue(wranglerContent, ADMIN_SESSION_TTL_SECONDS_NAME, "production"), "1800");
  assert.strictEqual(getWranglerValue(wranglerContent, ADMIN_SESSION_TTL_SECONDS_NAME, "staging"), "1800");
  assert.ok(writes.join("").includes("Updated wrangler.toml"));
  assert.ok(writes.join("").includes("Deploy the Worker: wrangler deploy"));
});

test("admin session can deploy after updating wrangler toml", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-session-deploy-"));
  const envPath = path.join(tmpDir, ".env");
  const wranglerPath = path.join(tmpDir, "wrangler.toml");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({}), "utf8");
  const calls = [];
  const writes = [];

  await main(["--env", envPath, "--toml", wranglerPath, "--ttl", "15m"], {
    output: { write: (message) => writes.push(message) },
    prompter: {
      confirm: async () => true,
    },
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0, stdout: "deployed", stderr: "" };
    },
  });

  assert.deepStrictEqual(calls, [
    { command: "wrangler", args: ["deploy"] },
  ]);
  assert.ok(writes.join("").includes("Deploying Worker..."));
  assert.ok(writes.join("").includes("Deployed Worker."));
});
