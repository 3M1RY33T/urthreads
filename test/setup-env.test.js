const assert = require("assert");
const { PassThrough } = require("stream");
const { test } = require("node:test");
const {
  buildEndpointUrl,
  buildEnvContent,
  collectConfig,
  createPrompter,
  parseD1DatabaseId,
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
  assert.ok(content.includes("ADMIN_API_KEY="));
  assert.ok(content.includes("ADMIN_API_KEY_EXPIRES_AT="));
  assert.ok(content.includes("MAX_COMMENTS_PER_POST=50"));
});

test("collects sensitive setup values through hidden prompts", async () => {
  const hiddenQuestions = [];
  const visibleQuestions = [];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      visibleQuestions.push(question);
      return defaultValue || `${question}-value`;
    },
    askHidden: async (question, defaultValue = "") => {
      hiddenQuestions.push(question);
      return defaultValue || `${question}-secret`;
    },
  };

  const writes = [];
  const config = await collectConfig(
    prompter,
    { write: (message) => writes.push(message) },
    { useWrangler: false }
  );

  assert.strictEqual(config.accountId, "Cloudflare account ID-secret");
  assert.strictEqual(config.apiToken, "Cloudflare API token-secret");
  assert.strictEqual(config.databaseId, "D1 database ID, if using an existing database-secret");
  assert.deepStrictEqual(hiddenQuestions, [
    "Cloudflare account ID",
    "Cloudflare API token",
    "D1 database ID, if using an existing database",
  ]);
  assert.ok(visibleQuestions.includes("D1 database name to create or use"));
  assert.ok(!writes.join("").includes("which is ignored by Git"));
});

test("parses D1 database IDs from wrangler output", () => {
  assert.strictEqual(
    parseD1DatabaseId('database_id = "a9ca5d89-1111-2222-3333-0123456789ab"'),
    "a9ca5d89-1111-2222-3333-0123456789ab"
  );
  assert.strictEqual(
    parseD1DatabaseId('{"database_id":"bbbbbbbb-1111-2222-3333-cccccccccccc"}'),
    "bbbbbbbb-1111-2222-3333-cccccccccccc"
  );
});

test("creates D1 database through Wrangler when authenticated", async () => {
  const calls = [];
  const hiddenQuestions = [];
  const confirmQuestions = [];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "D1 database name to create or use") return "threads-example";
      return defaultValue || `${question}-value`;
    },
    askHidden: async (question, defaultValue = "") => {
      hiddenQuestions.push(question);
      return defaultValue || `${question}-secret`;
    },
    confirm: async (question, defaultValue = true) => {
      confirmQuestions.push(question);
      if (question === "Add Cloudflare account ID or API token to .env anyway?") return false;
      return defaultValue;
    },
  };
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "d1") {
      return {
        status: 0,
        stdout: '[[d1_databases]]\ndatabase_name = "threads-example"\ndatabase_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"\n',
      };
    }
    return { status: 0, stdout: "ok\n" };
  };

  const config = await collectConfig(
    prompter,
    { write: () => {} },
    { runner }
  );

  assert.deepStrictEqual(calls, [
    ["wrangler", ["--version"]],
    ["wrangler", ["whoami"]],
    ["wrangler", ["d1", "create", "threads-example"]],
  ]);
  assert.strictEqual(config.accountId, "");
  assert.strictEqual(config.apiToken, "");
  assert.strictEqual(config.databaseName, "threads-example");
  assert.strictEqual(config.databaseId, "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
  assert.deepStrictEqual(hiddenQuestions, []);
  assert.ok(confirmQuestions.includes("Add Cloudflare account ID or API token to .env anyway?"));
  assert.ok(confirmQuestions.includes("Create D1 database 'threads-example' with Wrangler now?"));
});

test("hidden prompt falls back to normal prompt outside tty", async () => {
  const input = new PassThrough();
  input.isTTY = false;
  const output = new PassThrough();
  output.isTTY = false;
  const prompter = createPrompter(input, output);

  assert.strictEqual(typeof prompter.askHidden, "function");
  prompter.close();
});
