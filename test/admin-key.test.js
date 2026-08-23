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
  storeAdminKeySecret,
  upsertEnvVars,
  updateAdminKeyExpirationInWranglerToml,
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
    "D1_DATABASE_NAME=your-threads",
    "",
  ].join("\n");

  const updated = upsertEnvVars(content, {
    ADMIN_API_KEY: "new-key",
    ADMIN_API_KEY_EXPIRES_AT: "2026-06-19T12:00:00.000Z",
  });

  assert.ok(updated.includes("CLOUDFLARE_ACCOUNT_ID=account"));
  assert.ok(updated.includes("D1_DATABASE_NAME=your-threads"));
  assert.strictEqual((updated.match(/^ADMIN_API_KEY=/gm) || []).length, 1);
  assert.ok(updated.includes("ADMIN_API_KEY=new-key"));
  assert.ok(updated.includes("ADMIN_API_KEY_EXPIRES_AT=2026-06-19T12:00:00.000Z"));
});

test("writes a new env file when one does not exist", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-key-"));
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
  const args = parseArgs(["--env", ".env.local", "--expires=90d", "--toml", "wrangler.custom.toml"]);

  assert.strictEqual(args.envPath, ".env.local");
  assert.strictEqual(args.expires, "90d");
  assert.strictEqual(args.wranglerPath, "wrangler.custom.toml");
});

test("does not print generated admin key and copies it to clipboard", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-key-output-"));
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

test("next steps include the local development hint", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-key-hint-"));
  const envPath = path.join(tmpDir, ".env");
  let stdout = "";

  await main(["--env", envPath, "--expires", "never"], {
    output: { write: (chunk) => { stdout += chunk; } },
    prompter: null,
    generateAdminApiKey: () => "hint-test-key",
    copyToClipboard: () => ({ copied: false, command: "" }),
  });

  assert.ok(
    stdout.includes("For local development (no Cloudflare account needed): run npm run setup:dev"),
    "next steps must mention the no-Cloudflare local path"
  );
});

test("stores admin key secret through Wrangler without printing the secret", () => {
  const calls = [];
  const result = storeAdminKeySecret("secret-admin-key-value", {
    runner: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });

  assert.strictEqual(result.ok, true);
  assert.strictEqual(calls.length, 1);
  assert.deepStrictEqual(calls[0].args, ["secret", "put", "ADMIN_API_KEY"]);
  assert.strictEqual(calls[0].spawnOptions.input, "secret-admin-key-value\n");
  assert.deepStrictEqual(calls[0].spawnOptions.stdio, ["pipe", "pipe", "pipe"]);
});

test("updates admin key expiration in wrangler toml", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-key-wrangler-"));
  const wranglerPath = path.join(tmpDir, "wrangler.toml");

  fs.writeFileSync(wranglerPath, [
    "name = \"threads-example-worker\"",
    "",
    "[vars]",
    "WORKER_URL = \"https://threads-example-worker.example.workers.dev\"",
    "",
  ].join("\n"));

  const result = updateAdminKeyExpirationInWranglerToml(
    wranglerPath,
    "2026-06-01T00:00:00.000Z"
  );
  const content = fs.readFileSync(wranglerPath, "utf8");

  assert.strictEqual(result.ok, true);
  assert.ok(content.includes("ADMIN_API_KEY_EXPIRES_AT = \"2026-06-01T00:00:00.000Z\""));
});

test("can optionally store admin key, update expiration, and deploy", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-admin-key-deploy-"));
  const envPath = path.join(tmpDir, ".env");
  const wranglerPath = path.join(tmpDir, "wrangler.toml");
  const generatedKey = "secret-admin-key-value";
  const calls = [];
  const confirmations = [];
  let stdout = "";

  fs.writeFileSync(wranglerPath, [
    "name = \"threads-example-worker\"",
    "",
    "[vars]",
    "ADMIN_API_KEY_EXPIRES_AT = \"\"",
    "",
  ].join("\n"));

  await main(["--env", envPath, "--toml", wranglerPath, "--expires", "7d"], {
    output: { write: (chunk) => { stdout += chunk; } },
    prompter: {
      confirm: async (question) => {
        confirmations.push(question);
        return true;
      },
    },
    generateAdminApiKey: () => generatedKey,
    copyToClipboard: () => ({ copied: true, command: "test-clipboard" }),
    runner: (command, args, spawnOptions) => {
      calls.push({ command, args, spawnOptions });
      return { status: 0, stdout: "ok\n", stderr: "" };
    },
  });

  const wranglerContent = fs.readFileSync(wranglerPath, "utf8");

  assert.deepStrictEqual(confirmations, [
    "Store ADMIN_API_KEY as a Worker secret now?",
    "Update wrangler.toml with ADMIN_API_KEY_EXPIRES_AT?",
    "Deploy Worker now so the expiration takes effect?",
  ]);
  assert.deepStrictEqual(calls.map((call) => call.args), [
    ["secret", "put", "ADMIN_API_KEY"],
    ["deploy"],
  ]);
  assert.strictEqual(calls[0].spawnOptions.input, `${generatedKey}\n`);
  assert.ok(wranglerContent.includes("ADMIN_API_KEY_EXPIRES_AT = \""));
  assert.ok(stdout.includes("Stored ADMIN_API_KEY as a Worker secret."));
  assert.ok(stdout.includes("Deployed Worker."));
  assert.ok(!stdout.includes(generatedKey));
});
