const assert = require("assert");
const { PassThrough } = require("stream");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  askOriginList,
  buildEndpointUrl,
  buildEnvContent,
  buildDefaultWorkerName,
  buildDefaultWorkerUrl,
  collectConfig,
  createPrompter,
  createD1Database,
  parseD1DatabaseId,
  parseD1DatabaseList,
  normalizeUrl,
  redactSetupOutput,
  sanitizeOriginList,
  summarizeWranglerFailure,
  main,
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

test("builds valid default worker names from database names", () => {
  assert.strictEqual(buildDefaultWorkerName("threads-example"), "threads-example-worker");
  assert.strictEqual(buildDefaultWorkerName("My Threads_DB"), "my-threads-db-worker");
  assert.strictEqual(buildDefaultWorkerName("  ---  "), "urthreads-worker");
});

test("builds default worker URLs from worker name and workers.dev subdomain", () => {
  assert.strictEqual(
    buildDefaultWorkerUrl("threads-example-worker", "example-subdomain"),
    "https://threads-example-worker.example-subdomain.workers.dev"
  );
  assert.strictEqual(
    buildDefaultWorkerUrl("My Worker", "https://My-Account.workers.dev/"),
    "https://my-worker.my-account.workers.dev"
  );
  assert.strictEqual(buildDefaultWorkerUrl("threads-example-worker", ""), "");
});

test("redacts identifiers and local paths from setup output", () => {
  const redacted = redactSetupOutput(
    'database_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"\n/accounts/a9ca5d89fb7128fcc3e1a47abd5e913f/workers\n/Users/example/Library/Preferences/.wrangler/logs/log.txt\n'
  );

  assert.ok(!redacted.includes("aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"));
  assert.ok(!redacted.includes("a9ca5d89fb7128fcc3e1a47abd5e913f"));
  assert.ok(!redacted.includes("/Users/example"));
  assert.ok(redacted.includes("<redacted-id>"));
  assert.ok(redacted.includes("<redacted-account-id>"));
  assert.ok(redacted.includes("<redacted-path>"));
});

test("summarizes common wrangler setup failures", () => {
  assert.strictEqual(
    summarizeWranglerFailure("A database with that name already exists"),
    "A D1 database with that name already exists, but setup could not read its ID automatically."
  );
  assert.strictEqual(
    summarizeWranglerFailure("You are not authenticated"),
    "Wrangler is not authenticated for this command."
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
    allowedOrigins: "http://localhost:8000,http://[::1]:8000",
    allowedOriginsStaging: "http://localhost:8787,http://[::1]:8000",
    allowedOriginsProd: "http://localhost:8000,http://[::1]:8000",
    maxCommentsPerPost: "50",
  });

  assert.ok(content.includes("CLOUDFLARE_ACCOUNT_ID=account"));
  assert.ok(content.includes("D1_DATABASE_NAME=db"));
  assert.ok(content.includes("LIKES_ENDPOINT=https://worker.example.workers.dev/likes"));
  assert.ok(content.includes("COMMENTS_ENDPOINT=https://worker.example.workers.dev/comments"));
  assert.ok(content.includes("ALLOWED_ORIGINS_PROD=http://localhost:8000,http://[::1]:8000"));
  assert.ok(content.includes("http://[::1]:8000"));
  assert.ok(content.includes("ADMIN_API_KEY="));
  assert.ok(content.includes("ADMIN_API_KEY_EXPIRES_AT="));
  assert.ok(content.includes("MAX_COMMENTS_PER_POST=50"));
});

test("setup defaults allowed origins to localhost-only values", () => {
  const content = buildEnvContent({});

  assert.ok(content.includes("ALLOWED_ORIGINS=http://localhost:8000,http://[::1]:8000"));
  assert.ok(content.includes("ALLOWED_ORIGINS_STAGING=http://localhost:3000,http://localhost:8000,http://[::1]:8000,http://localhost:8787"));
  assert.ok(content.includes("ALLOWED_ORIGINS_PROD=http://localhost:8000,http://[::1]:8000"));
  assert.ok(!content.includes("https://example.com"));
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

test("parses existing D1 database IDs from wrangler list output", () => {
  const databaseId = parseD1DatabaseList(JSON.stringify([
    { name: "other-db", uuid: "11111111-1111-1111-1111-111111111111" },
    { name: "threads-example", uuid: "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb" },
  ]), "threads-example");

  assert.strictEqual(databaseId, "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
});

test("reuses existing D1 database when create reports a duplicate name", () => {
  const calls = [];
  const result = createD1Database("threads-example", {
    runner: (command, args) => {
      calls.push([command, args]);
      if (args[1] === "create") {
        return {
          status: 1,
          stderr: "A database with that name already exists\n",
        };
      }
      return {
        status: 0,
        stdout: JSON.stringify([
          { name: "threads-example", uuid: "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb" },
        ]),
      };
    },
  });

  assert.deepStrictEqual(calls, [
    ["wrangler", ["d1", "create", "threads-example"]],
    ["wrangler", ["d1", "list", "--json"]],
  ]);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reused, true);
  assert.strictEqual(result.databaseId, "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
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

test("prompts for wrangler login when whoami says not authenticated", async () => {
  const calls = [];
  const confirmQuestions = [];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "D1 database name to create or use") return "threads-example";
      return defaultValue || `${question}-value`;
    },
    askHidden: async (question, defaultValue = "") => defaultValue,
    confirm: async (question, defaultValue = true) => {
      confirmQuestions.push(question);
      if (question === "Add Cloudflare account ID or API token to .env anyway?") return false;
      return defaultValue;
    },
  };
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "whoami" && calls.filter((call) => call[1][0] === "whoami").length === 1) {
      return {
        status: 0,
        stdout: "You are not authenticated. Please run `wrangler login`.\n",
      };
    }
    if (args[0] === "d1") {
      return {
        status: 0,
        stdout: 'database_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"\n',
      };
    }
    return { status: 0, stdout: "ok\n" };
  };

  const config = await collectConfig(
    prompter,
    { write: () => {} },
    { runner }
  );

  assert.deepStrictEqual(calls.map((call) => call[1][0]), [
    "--version",
    "whoami",
    "login",
    "whoami",
    "d1",
  ]);
  assert.ok(confirmQuestions.includes("Run wrangler login now?"));
  assert.strictEqual(config.databaseId, "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb");
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

test("setup writes example Worker config from configured Worker URL", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-setup-main-"));
  const oldCwd = process.cwd();
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "Worker URL") return "https://worker.example.dev/";
      return defaultValue || `${question}-value`;
    },
    askHidden: async (question, defaultValue = "") => defaultValue || `${question}-secret`,
    confirm: async (question, defaultValue = true) => {
      if (question === "Create wrangler.toml from these answers too?") return false;
      return defaultValue;
    },
    close: () => {},
  };

  try {
    process.chdir(tempDir);
    await main([], {
      output: { write: () => {} },
      prompter,
      useWrangler: false,
    });
  } finally {
    process.chdir(oldCwd);
  }

  assert.ok(fs.existsSync(path.join(tempDir, ".env")));
  const config = fs.readFileSync(path.join(tempDir, "examples", "urthreads-worker-config.js"), "utf8");
  assert.ok(config.includes("https://worker.example.dev"));
});

test("setup can initialize schema and deploy when worker url is derived", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-setup-deploy-"));
  const oldCwd = process.cwd();
  const calls = [];
  const confirmQuestions = [];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "D1 database name to create or use") return "threads-example";
      if (question === "Workers.dev subdomain, if known") return "example-subdomain";
      return defaultValue;
    },
    askHidden: async (question, defaultValue = "") => defaultValue,
    confirm: async (question, defaultValue = true) => {
      confirmQuestions.push(question);
      if (question === "Add Cloudflare account ID or API token to .env anyway?") return false;
      if (question === "Create wrangler.toml from these answers too?") return true;
      if (question === "Initialize D1 schema and deploy Worker now?") return true;
      return defaultValue;
    },
    close: () => {},
  };
  const runner = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "d1" && args[1] === "create") {
      return {
        status: 0,
        stdout: 'database_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"\n',
      };
    }
    return { status: 0, stdout: "ok\n" };
  };

  try {
    process.chdir(tempDir);
    await main([], {
      output: { write: () => {} },
      prompter,
      runner,
    });
  } finally {
    process.chdir(oldCwd);
  }

  assert.ok(confirmQuestions.includes("Initialize D1 schema and deploy Worker now?"));
  assert.deepStrictEqual(calls.map((call) => call[1]), [
    ["--version"],
    ["whoami"],
    ["d1", "create", "threads-example"],
    ["d1", "execute", "threads-example", "--remote", "--file=src/schema.sql"],
    ["deploy"],
  ]);
});

test("askOriginList rejects wildcard origins and re-prompts", async () => {
  const questions = [];
  const answers = ["*", "https://example.com,https://www.example.com"];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      questions.push(question);
      return answers.shift() || defaultValue;
    },
  };
  const writes = [];
  const value = await askOriginList(
    prompter,
    "Allowed origins",
    "http://localhost:8000",
    { write: (message) => writes.push(message) }
  );

  assert.strictEqual(value, "https://example.com,https://www.example.com");
  assert.strictEqual(questions.length, 2);
  assert.ok(writes.join("").includes("not '*'"));
});

test("collectConfig re-prompts wildcard origin input", async () => {
  const writes = [];
  const originAnswers = ["*", "https://prod.example"];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "Production allowed origins") return originAnswers.shift() || defaultValue;
      return defaultValue;
    },
    askHidden: async (question, defaultValue = "") => defaultValue,
    confirm: async (question, defaultValue = true) => false,
  };

  const config = await collectConfig(
    prompter,
    { write: (message) => writes.push(message) },
    { useWrangler: false }
  );

  assert.strictEqual(config.allowedOriginsProd, "https://prod.example");
  assert.ok(writes.join("").includes("Allowed origins must be exact http or https origins, not '*'"));
});

test("setup does not offer deployment when worker url cannot be derived", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-setup-no-deploy-"));
  const oldCwd = process.cwd();
  const confirmQuestions = [];
  const prompter = {
    ask: async (question, defaultValue = "") => {
      if (question === "D1 database name to create or use") return "threads-example";
      if (question === "Workers.dev subdomain, if known") return "";
      return defaultValue;
    },
    askHidden: async (question, defaultValue = "") => defaultValue,
    confirm: async (question, defaultValue = true) => {
      confirmQuestions.push(question);
      if (question === "Add Cloudflare account ID or API token to .env anyway?") return false;
      if (question === "Create wrangler.toml from these answers too?") return false;
      return defaultValue;
    },
    close: () => {},
  };
  const runner = (command, args) => {
    if (args[0] === "d1" && args[1] === "create") {
      return {
        status: 0,
        stdout: 'database_id = "aaaaaaaa-1111-2222-3333-bbbbbbbbbbbb"\n',
      };
    }
    return { status: 0, stdout: "ok\n" };
  };

  try {
    process.chdir(tempDir);
    await main([], {
      output: { write: () => {} },
      prompter,
      runner,
    });
  } finally {
    process.chdir(oldCwd);
  }

  assert.ok(!confirmQuestions.includes("Initialize D1 schema and deploy Worker now?"));
});
