const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  copyEnvValue,
  getOpenCommand,
  main,
  mergeAllowedOrigins,
  normalizeOrigin,
  parseEnvContent,
  resolveOriginKey,
} = require("../src/env-config");
const {
  buildWranglerTomlContent,
  getWranglerValue,
} = require("../src/wrangler-config");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-env-"));
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
  assert.strictEqual(
    mergeAllowedOrigins("http://localhost:8000", ["http://localhost:8000, https://example.com"]),
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
    ["add-origin", "http://localhost:8000", "https://example.com", "--env", envPath, "--no-sync"],
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

test("adds allowed origins to env and wrangler without dropping either file's existing origins", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const wranglerPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(envPath, "ALLOWED_ORIGINS=https://from-env.example\nOTHER=value\n", "utf8");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({
    allowedOrigins: "https://from-wrangler.example",
  }), "utf8");

  const writes = [];
  await main(
    [
      "add-origin",
      "https://new.example, http://localhost:8000",
      "--env",
      envPath,
      "--toml",
      wranglerPath,
    ],
    {
      commandName: "urthreads env",
      output: { write: (message) => writes.push(message) },
    }
  );

  const expected = "https://from-env.example,https://from-wrangler.example,https://new.example,http://localhost:8000";
  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  const wranglerContent = fs.readFileSync(wranglerPath, "utf8");
  assert.strictEqual(values.ALLOWED_ORIGINS, expected);
  assert.strictEqual(getWranglerValue(wranglerContent, "ALLOWED_ORIGINS"), expected);
  assert.ok(writes.join("").includes("wrangler.toml"));
});

test("adds production origins to production wrangler vars", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const wranglerPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(envPath, "ALLOWED_ORIGINS_PROD=https://prod-env.example\n", "utf8");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({
    allowedOriginsProd: "https://prod-wrangler.example",
  }), "utf8");

  await main(
    ["add-origin", "https://prod-new.example", "--target", "prod", "--env", envPath, "--toml", wranglerPath],
    {
      commandName: "urthreads env",
      output: { write: () => {} },
    }
  );

  const expected = "https://prod-env.example,https://prod-wrangler.example,https://prod-new.example";
  assert.strictEqual(parseEnvContent(fs.readFileSync(envPath, "utf8")).ALLOWED_ORIGINS_PROD, expected);
  assert.strictEqual(getWranglerValue(fs.readFileSync(wranglerPath, "utf8"), "ALLOWED_ORIGINS", "production"), expected);
});

test("adds origins to staging and production with flags and syncs wrangler", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const wranglerPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(envPath, [
    "ALLOWED_ORIGINS=http://localhost:8000",
    "ALLOWED_ORIGINS_STAGING=http://localhost:3000",
    "ALLOWED_ORIGINS_PROD=http://localhost:8000",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({
    allowedOriginsStaging: "http://localhost:8787",
    allowedOriginsProd: "https://prod-wrangler.example",
  }), "utf8");
  const writes = [];

  await main(
    [
      "add-origin",
      "https://dashboard.example",
      "--staging",
      "--production",
      "--env",
      envPath,
      "--toml",
      wranglerPath,
    ],
    {
      commandName: "urthreads env",
      output: { write: (message) => writes.push(message) },
    }
  );

  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  const wranglerContent = fs.readFileSync(wranglerPath, "utf8");
  assert.strictEqual(values.ALLOWED_ORIGINS, "http://localhost:8000");
  assert.strictEqual(values.ALLOWED_ORIGINS_STAGING, "http://localhost:3000,http://localhost:8787,https://dashboard.example");
  assert.strictEqual(values.ALLOWED_ORIGINS_PROD, "http://localhost:8000,https://prod-wrangler.example,https://dashboard.example");
  assert.strictEqual(
    getWranglerValue(wranglerContent, "ALLOWED_ORIGINS", "staging"),
    "http://localhost:3000,http://localhost:8787,https://dashboard.example"
  );
  assert.strictEqual(
    getWranglerValue(wranglerContent, "ALLOWED_ORIGINS", "production"),
    "http://localhost:8000,https://prod-wrangler.example,https://dashboard.example"
  );
  assert.ok(writes.join("").includes("ALLOWED_ORIGINS_STAGING="));
  assert.ok(writes.join("").includes("ALLOWED_ORIGINS_PROD="));
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

test("sets shared env values in env and wrangler toml", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const wranglerPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({}), "utf8");

  await main(["set", "MAX_COMMENTS_PER_POST", "25", "--env", envPath, "--toml", wranglerPath], {
    commandName: "urthreads env",
    output: { write: () => {} },
  });

  assert.strictEqual(parseEnvContent(fs.readFileSync(envPath, "utf8")).MAX_COMMENTS_PER_POST, "25");
  assert.strictEqual(getWranglerValue(fs.readFileSync(wranglerPath, "utf8"), "MAX_COMMENTS_PER_POST"), "25");
});

test("sets multiple allowed origins through env set and syncs wrangler", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const wranglerPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(wranglerPath, buildWranglerTomlContent({}), "utf8");

  await main([
    "set",
    "ALLOWED_ORIGINS",
    "https://one.example,",
    "https://two.example/",
    "--env",
    envPath,
    "--toml",
    wranglerPath,
  ], {
    commandName: "urthreads env",
    output: { write: () => {} },
  });

  const expected = "https://one.example,https://two.example";
  assert.strictEqual(parseEnvContent(fs.readFileSync(envPath, "utf8")).ALLOWED_ORIGINS, expected);
  assert.strictEqual(getWranglerValue(fs.readFileSync(wranglerPath, "utf8"), "ALLOWED_ORIGINS"), expected);
});

test("setting worker url updates browser example config", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const oldCwd = process.cwd();
  const writes = [];

  try {
    process.chdir(tempDir);
    await main(["set", "WORKER_URL", "https://worker.example.dev/", "--env", envPath], {
      commandName: "urthreads env",
      output: { write: (message) => writes.push(message) },
    });
  } finally {
    process.chdir(oldCwd);
  }

  const configPath = path.join(tempDir, "examples", "urthreads-worker-config.js");
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.readFileSync(configPath, "utf8").includes("https://worker.example.dev"));
  assert.ok(writes.join("").includes("examples/urthreads-worker-config.js"));
});

test("copies env values to clipboard without printing the value", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, "ADMIN_API_KEY=secret-value\nWORKER_URL=https://worker.example.dev\n", "utf8");
  const writes = [];
  const copied = [];

  await main(["copy", "ADMIN_API_KEY", "--env", envPath], {
    commandName: "urthreads env",
    output: { write: (message) => writes.push(message) },
    copyToClipboard: (value) => {
      copied.push(value);
      return { copied: true, command: "test-copy" };
    },
  });

  assert.deepStrictEqual(copied, ["secret-value"]);
  assert.ok(writes.join("").includes("Copied ADMIN_API_KEY to your clipboard."));
  assert.ok(!writes.join("").includes("secret-value"));
});

test("copies dashboard shortcuts to clipboard", async () => {
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  fs.writeFileSync(envPath, "WORKER_URL=https://worker.example.dev\n", "utf8");
  const copied = [];

  await main(["copy-worker-url", "--env", envPath], {
    commandName: "urthreads env",
    output: { write: () => {} },
    copyToClipboard: (value) => {
      copied.push(value);
      return { copied: true, command: "test-copy" };
    },
  });

  assert.deepStrictEqual(copied, ["https://worker.example.dev"]);
  assert.strictEqual(
    copyEnvValue(envPath, "WORKER_URL", {
      copyToClipboard: (value) => ({ copied: value === "https://worker.example.dev", command: "test-copy" }),
    }).copied,
    true
  );
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
