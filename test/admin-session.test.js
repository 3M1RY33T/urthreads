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
  const args = parseArgs(["--env", ".env.local", "--ttl=30m"]);

  assert.strictEqual(args.envPath, ".env.local");
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
