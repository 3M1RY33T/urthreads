const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  buildWranglerTomlContent,
  collectWranglerConfig,
  getWranglerValue,
  listWranglerValues,
  main,
  updateWranglerToml,
} = require("../src/wrangler-config");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-wrangler-"));
}

test("builds wrangler toml content from config", () => {
  const content = buildWranglerTomlContent({
    workerName: "worker",
    accountId: "account",
    databaseName: "db",
    databaseId: "db-id",
    allowedOrigins: "https://example.com",
  });

  assert.ok(content.includes('name = "worker"'));
  assert.ok(content.includes('account_id = "account"'));
  assert.ok(content.includes('database_name = "db"'));
  assert.ok(content.includes('database_id = "db-id"'));
  assert.ok(content.includes('WORKER_URL = ""'));
  assert.ok(content.includes("[env.production.vars]"));
});

test("wrangler defaults allowed origins to localhost-only values", () => {
  const content = buildWranglerTomlContent({});

  assert.strictEqual(getWranglerValue(content, "ALLOWED_ORIGINS"), "http://localhost:8000,http://[::1]:8000");
  assert.strictEqual(getWranglerValue(content, "ALLOWED_ORIGINS", "production"), "https://your-production-site.example.com");
  assert.strictEqual(
    getWranglerValue(content, "ALLOWED_ORIGINS", "staging"),
    "http://localhost:3000,http://localhost:8000,http://[::1]:8000,http://localhost:8787"
  );
});

test("reuses default D1 database for environments unless overridden", () => {
  const content = buildWranglerTomlContent({
    databaseName: "created-db",
    databaseId: "real-db-id",
  });

  assert.ok(!content.includes("00000000-0000-0000-0000-000000000000"));
  assert.strictEqual(getWranglerValue(content, "database_name", "production"), "created-db");
  assert.strictEqual(getWranglerValue(content, "database_id", "production"), "real-db-id");
  assert.strictEqual(getWranglerValue(content, "database_name", "staging"), "created-db");
  assert.strictEqual(getWranglerValue(content, "database_id", "staging"), "real-db-id");
});

test("wrangler init defaults reuse the entered D1 database for environments", async () => {
  const config = await collectWranglerConfig(
    {
      ask: async (question, defaultValue = "") => {
        if (question === "D1 database name") return "created-db";
        if (question === "D1 database ID") return "real-db-id";
        return defaultValue;
      },
    },
    { write: () => {} }
  );

  assert.strictEqual(config.productionDatabaseName, "created-db");
  assert.strictEqual(config.productionDatabaseId, "real-db-id");
  assert.strictEqual(config.stagingDatabaseName, "created-db");
  assert.strictEqual(config.stagingDatabaseId, "real-db-id");
});

test("updates default and environment wrangler values", () => {
  let content = buildWranglerTomlContent({
    workerName: "worker",
    databaseName: "db",
    databaseId: "db-id",
  });

  content = updateWranglerToml(content, "database_id", "new-db-id");
  content = updateWranglerToml(content, "ALLOWED_ORIGINS", "https://prod.example", "production");
  content = updateWranglerToml(content, "workers_dev", "false");

  assert.strictEqual(getWranglerValue(content, "database_id"), "new-db-id");
  assert.strictEqual(getWranglerValue(content, "ALLOWED_ORIGINS", "production"), "https://prod.example");
  assert.strictEqual(getWranglerValue(content, "workers_dev"), "false");
});

test("lists wrangler values", () => {
  const values = listWranglerValues(buildWranglerTomlContent({
    workerName: "worker",
    databaseName: "db",
    databaseId: "db-id",
  }));

  assert.ok(values.some((item) => item.section === "default" && item.key === "name" && item.value === "worker"));
  assert.ok(values.some((item) => item.section === "vars" && item.key === "D1_DATABASE_NAME" && item.value === "db"));
});

test("sets wrangler values through cli", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(tomlPath, buildWranglerTomlContent({}), "utf8");

  await main(["set", "database_id", "cli-db-id", "--file", tomlPath], {
    commandName: "urthreads wrangler",
    output: { write: () => {} },
  });

  const content = fs.readFileSync(tomlPath, "utf8");
  assert.strictEqual(getWranglerValue(content, "database_id"), "cli-db-id");
});

test("setting wrangler worker url updates browser example config", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");
  fs.writeFileSync(tomlPath, buildWranglerTomlContent({}), "utf8");
  const oldCwd = process.cwd();

  try {
    process.chdir(tempDir);
    await main(["set", "WORKER_URL", "https://worker.example.dev/", "--file", tomlPath], {
      commandName: "urthreads wrangler",
      output: { write: () => {} },
    });
  } finally {
    process.chdir(oldCwd);
  }

  const configPath = path.join(tempDir, "examples", "urthreads-worker-config.js");
  assert.ok(fs.existsSync(configPath));
  assert.ok(fs.readFileSync(configPath, "utf8").includes("https://worker.example.dev"));
});

test("creates wrangler toml through cli with provided config", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");

  await main(["init", "--file", tomlPath], {
    commandName: "urthreads wrangler-init",
    output: { write: () => {} },
    config: {
      workerName: "created-worker",
      databaseName: "created-db",
      databaseId: "created-db-id",
    },
  });

  const content = fs.readFileSync(tomlPath, "utf8");
  assert.strictEqual(getWranglerValue(content, "name"), "created-worker");
  assert.strictEqual(getWranglerValue(content, "database_name"), "created-db");
});

test("refuses to store sensitive wrangler keys through cli set", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");
  const original = buildWranglerTomlContent({});
  fs.writeFileSync(tomlPath, original, "utf8");

  await assert.rejects(
    main(["set", "ADMIN_API_KEY", "supersecret", "--file", tomlPath], {
      commandName: "urthreads wrangler",
      output: { write: () => {} },
    }),
    /Refusing to store sensitive value ADMIN_API_KEY.*wrangler secret put/
  );

  assert.strictEqual(fs.readFileSync(tomlPath, "utf8"), original);
});

test("hides sensitive values from cli get unless --show-sensitive is passed", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");
  let content = buildWranglerTomlContent({});
  content = updateWranglerToml(content, "ADMIN_API_KEY", "supersecret");
  fs.writeFileSync(tomlPath, content, "utf8");

  const hiddenWrites = [];
  await main(["get", "ADMIN_API_KEY", "--file", tomlPath], {
    commandName: "urthreads wrangler",
    output: { write: (message) => hiddenWrites.push(message) },
  });
  const hiddenOutput = hiddenWrites.join("");
  assert.ok(hiddenOutput.includes("ADMIN_API_KEY=(hidden)"));
  assert.ok(!hiddenOutput.includes("supersecret"));

  const shownWrites = [];
  await main(["get", "ADMIN_API_KEY", "--show-sensitive", "--file", tomlPath], {
    commandName: "urthreads wrangler",
    output: { write: (message) => shownWrites.push(message) },
  });
  assert.ok(shownWrites.join("").includes("ADMIN_API_KEY=supersecret"));
});

test("includes localhost warning when production origins contain localhost", () => {
  const content = buildWranglerTomlContent({
    allowedOriginsProd: "http://localhost:8000",
  });

  assert.ok(
    content.includes("# WARNING: localhost origins detected in production config. Replace with your actual production URL."),
    "expected localhost warning comment in production section"
  );
});

test("does not include localhost warning when production origins are not localhost", () => {
  const content = buildWranglerTomlContent({
    allowedOriginsProd: "https://example.com",
  });

  assert.ok(
    !content.includes("# WARNING: localhost origins detected in production config."),
    "did not expect localhost warning comment for non-localhost production origins"
  );
});

test("hides sensitive values from cli list unless --show-sensitive is passed", async () => {
  const tempDir = makeTempDir();
  const tomlPath = path.join(tempDir, "wrangler.toml");
  let content = buildWranglerTomlContent({});
  content = updateWranglerToml(content, "ADMIN_API_KEY", "supersecret");
  content = updateWranglerToml(content, "ALLOWED_ORIGINS", "https://example.com");
  fs.writeFileSync(tomlPath, content, "utf8");

  const writes = [];
  await main(["list", "--file", tomlPath], {
    commandName: "urthreads wrangler",
    output: { write: (message) => writes.push(message) },
  });
  const output = writes.join("");
  assert.ok(output.includes("vars.ALLOWED_ORIGINS=https://example.com"));
  assert.ok(output.includes("vars.ADMIN_API_KEY=(hidden)"));
  assert.ok(!output.includes("supersecret"));

  const shownWrites = [];
  await main(["list", "--show-sensitive", "--file", tomlPath], {
    commandName: "urthreads wrangler",
    output: { write: (message) => shownWrites.push(message) },
  });
  assert.ok(shownWrites.join("").includes("vars.ADMIN_API_KEY=supersecret"));
});
