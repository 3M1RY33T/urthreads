const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  buildDashboard,
  main,
  normalizeDashboardEndpoint,
  parseArgs,
} = require("../src/dashboard-config");
const { parseEnvContent } = require("../src/env-config");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-dashboard-"));
}

test("normalizes dashboard endpoint names", () => {
  assert.strictEqual(normalizeDashboardEndpoint("/urthreads/"), "urthreads");
  assert.throws(() => normalizeDashboardEndpoint("../admin"), /local path segment/);
  assert.throws(() => normalizeDashboardEndpoint("https://example.com/admin"), /local path segment/);
});

test("parses dashboard CLI flags", () => {
  const args = parseArgs(["set", "--path", "public", "--endpoint", "admin", "--env", ".env.local"]);

  assert.strictEqual(args.command, "set");
  assert.strictEqual(args.localPath, "public");
  assert.strictEqual(args.endpoint, "admin");
  assert.strictEqual(args.envPath, ".env.local");
});

test("builds dashboard into endpoint and copies assets", () => {
  const tempDir = makeTempDir();
  const result = buildDashboard({ localPath: tempDir, endpoint: "urthreads" });

  assert.strictEqual(result.dashboardPath, path.join(tempDir, "urthreads"));
  assert.ok(fs.existsSync(path.join(tempDir, "urthreads", "index.html")));
  assert.ok(fs.existsSync(path.join(tempDir, "urthreads", "dashboard.js")));
  assert.ok(fs.existsSync(path.join(tempDir, "urthreads", "styles.css")));
  assert.ok(fs.existsSync(path.join(tempDir, "assets", "img", "urthreads.png")));
});

test("dashboard set stores path and builds dashboard", async () => {
  const cwd = process.cwd();
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const publicPath = path.join(tempDir, "public");
  const writes = [];

  try {
    process.chdir(tempDir);
    await main(["set", publicPath, "admin", "--env", envPath], {
      output: { write: (message) => writes.push(message) },
      commandName: "urthreads dashboard",
      prompter: { confirm: async () => true },
    });
  } finally {
    process.chdir(cwd);
  }

  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  assert.strictEqual(values.DASHBOARD_LOCAL_PATH, publicPath);
  assert.strictEqual(values.DASHBOARD_ENDPOINT, "admin");
  assert.ok(fs.existsSync(path.join(publicPath, "admin", "index.html")));
  assert.ok(writes.join("").includes("Built dashboard"));
});

test("dashboard build refreshes from saved env values", async () => {
  const cwd = process.cwd();
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const publicPath = path.join(tempDir, "public");
  const dashboardIndex = path.join(publicPath, "urthreads", "index.html");

  fs.writeFileSync(envPath, `DASHBOARD_LOCAL_PATH=${publicPath}\nDASHBOARD_ENDPOINT=urthreads\n`, "utf8");
  fs.mkdirSync(path.dirname(dashboardIndex), { recursive: true });
  fs.writeFileSync(dashboardIndex, "old dashboard", "utf8");

  try {
    process.chdir(tempDir);
    await main(["build", "--env", envPath], {
      output: { write: () => {} },
      commandName: "urthreads dashboard",
    });
  } finally {
    process.chdir(cwd);
  }

  const content = fs.readFileSync(dashboardIndex, "utf8");
  assert.ok(content.includes("Urthreads Dashboard"));
});

test("dashboard build prompts for missing path and saves it", async () => {
  const cwd = process.cwd();
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const publicPath = path.join(tempDir, "site-public");
  const questions = [];
  const writes = [];

  try {
    process.chdir(tempDir);
    await main(["build", "--env", envPath], {
      output: { write: (message) => writes.push(message) },
      commandName: "urthreads dashboard",
      prompter: {
        ask: async (question, defaultValue) => {
          questions.push({ question, defaultValue });
          if (question.includes("output path")) return publicPath;
          return "admin";
        },
        confirm: async () => true,
      },
    });
  } finally {
    process.chdir(cwd);
  }

  const values = parseEnvContent(fs.readFileSync(envPath, "utf8"));
  assert.deepStrictEqual(questions, [
    { question: "Static site output path for the dashboard", defaultValue: "public" },
    { question: "Dashboard endpoint directory", defaultValue: "urthreads" },
  ]);
  assert.strictEqual(values.DASHBOARD_LOCAL_PATH, publicPath);
  assert.strictEqual(values.DASHBOARD_ENDPOINT, "admin");
  assert.ok(fs.existsSync(path.join(publicPath, "admin", "index.html")));
  assert.ok(writes.join("").includes("Updated "));
});

test("dashboard set asks before creating a missing path", async () => {
  const cwd = process.cwd();
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const publicPath = path.join(tempDir, "missing-public");
  const confirms = [];
  const writes = [];

  try {
    process.chdir(tempDir);
    await main(["set", publicPath, "admin", "--env", envPath], {
      output: { write: (message) => writes.push(message) },
      commandName: "urthreads dashboard",
      prompter: {
        confirm: async (question, defaultValue) => {
          confirms.push({ question, defaultValue });
          return true;
        },
      },
    });
  } finally {
    process.chdir(cwd);
  }

  assert.strictEqual(confirms.length, 1);
  assert.ok(confirms[0].question.includes(publicPath));
  assert.strictEqual(confirms[0].defaultValue, true);
  assert.ok(fs.existsSync(path.join(publicPath, "admin", "index.html")));
  assert.ok(writes.join("").includes("Created "));
});

test("dashboard set cancels when missing path creation is declined", async () => {
  const cwd = process.cwd();
  const tempDir = makeTempDir();
  const envPath = path.join(tempDir, ".env");
  const publicPath = path.join(tempDir, "missing-public");

  try {
    process.chdir(tempDir);
    await assert.rejects(
      main(["set", publicPath, "admin", "--env", envPath], {
        output: { write: () => {} },
        commandName: "urthreads dashboard",
        prompter: { confirm: async () => false },
      }),
      /Dashboard build cancelled/
    );
  } finally {
    process.chdir(cwd);
  }

  assert.strictEqual(fs.existsSync(publicPath), false);
  assert.strictEqual(fs.existsSync(envPath), false);
});
