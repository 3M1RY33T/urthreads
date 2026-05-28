const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  buildCleanTargets,
  inferDatabaseName,
  inferWorkerName,
  main,
  parseArgs,
} = require("../src/backout");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "urthreads-backout-"));
}

function makeOutput() {
  const writes = [];
  return {
    writes,
    output: { write: (message) => writes.push(message) },
  };
}

function makePrompter(answers = []) {
  return {
    confirm: async () => Boolean(answers.shift()),
    confirmText: async (_question, expected) => {
      const answer = answers.shift();
      return answer === expected;
    },
    close: () => {},
  };
}

test("parses back-out command flags", () => {
  const args = parseArgs([
    "clean-env",
    "--delete-worker",
    "--yes",
    "--env",
    "production",
    "--name",
    "urthreads-worker",
    "--dry-run",
  ]);

  assert.strictEqual(args.command, "clean-env");
  assert.strictEqual(args.deleteWorker, true);
  assert.strictEqual(parseArgs(["delete-worker", "--delete-database"]).deleteDatabase, true);
  assert.strictEqual(parseArgs(["delete-worker", "--delete-d1"]).deleteDatabase, true);
  assert.strictEqual(parseArgs(["delete-worker", "--database", "threads-db"]).databaseName, "threads-db");
  assert.strictEqual(args.yes, true);
  assert.strictEqual(args.envName, "production");
  assert.strictEqual(args.workerName, "urthreads-worker");
  assert.strictEqual(args.dryRun, true);
  assert.strictEqual(parseArgs(["delete-worker", "--keep-local"]).keepLocal, true);
});

test("builds clean targets from existing generated files and caches", () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  fs.mkdirSync(path.join(tempDir, ".wrangler"));
  fs.mkdirSync(path.join(tempDir, "dist"));

  const cleanTargets = buildCleanTargets(parseArgs(["clean"]), tempDir)
    .map((filePath) => path.basename(filePath))
    .sort();

  assert.deepStrictEqual(cleanTargets, [".wrangler", "dist"]);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), true);

  const cleanAllTargets = buildCleanTargets(parseArgs(["clean-all"]), tempDir)
    .map((filePath) => path.basename(filePath))
    .sort();

  assert.deepStrictEqual(cleanAllTargets, [".env", ".wrangler", "dist", "wrangler.toml"]);
});

test("cleans local env files after confirmation", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  const { writes, output } = makeOutput();

  await main(["clean-env"], {
    cwd: tempDir,
    output,
    prompter: makePrompter([false, true]),
  });

  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), false);
  assert.ok(writes.join("").includes("Removed .env"));
  assert.ok(writes.join("").includes("Removed wrangler.toml"));
});

test("clean keeps environment files and removes caches and working files", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  fs.mkdirSync(path.join(tempDir, ".wrangler"));
  fs.mkdirSync(path.join(tempDir, "coverage"));

  await main(["clean"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter([true]),
  });

  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".wrangler")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "coverage")), false);
});

test("clean removes configured dashboard working files", async () => {
  const tempDir = makeTempDir();
  const publicPath = path.join(tempDir, "public");
  fs.writeFileSync(
    path.join(tempDir, ".env"),
    `DASHBOARD_LOCAL_PATH=${publicPath}\nDASHBOARD_ENDPOINT=urthreads\n`,
    "utf8"
  );
  fs.mkdirSync(path.join(publicPath, "urthreads"), { recursive: true });
  fs.mkdirSync(path.join(publicPath, "assets", "img"), { recursive: true });
  fs.mkdirSync(path.join(publicPath, "assets", "svg"), { recursive: true });
  fs.writeFileSync(path.join(publicPath, "urthreads", "index.html"), "dashboard", "utf8");
  fs.writeFileSync(path.join(publicPath, "urthreads", "dashboard.js"), "dashboard js", "utf8");
  fs.writeFileSync(path.join(publicPath, "urthreads", "styles.css"), "dashboard css", "utf8");
  fs.writeFileSync(path.join(publicPath, "urthreads", "custom.txt"), "user dashboard note", "utf8");
  fs.writeFileSync(path.join(publicPath, "assets", "img", "urthreads.png"), "image", "utf8");
  fs.writeFileSync(path.join(publicPath, "assets", "svg", "cloudflare.svg"), "svg", "utf8");
  fs.writeFileSync(path.join(publicPath, "assets", "keep.txt"), "user asset", "utf8");

  await main(["clean"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter([true]),
  });

  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "urthreads")), true);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "urthreads", "index.html")), false);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "urthreads", "dashboard.js")), false);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "urthreads", "styles.css")), false);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "urthreads", "custom.txt")), true);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "assets", "img")), true);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "assets", "svg")), true);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "assets", "img", "urthreads.png")), false);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "assets", "svg", "cloudflare.svg")), false);
  assert.strictEqual(fs.existsSync(path.join(publicPath, "assets", "keep.txt")), true);
});

test("clean-all removes caches, working files, and environment files", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  fs.mkdirSync(path.join(tempDir, ".wrangler"));
  fs.mkdirSync(path.join(tempDir, "dist"));

  await main(["clean-all"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter([false, true]),
  });

  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".wrangler")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "dist")), false);
});

test("clean-all stops when worker deletion confirmation is cancelled", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  fs.mkdirSync(path.join(tempDir, ".wrangler"));
  const calls = [];
  const { writes, output } = makeOutput();

  await main(["clean-all"], {
    cwd: tempDir,
    output,
    prompter: makePrompter([true, "nope"]),
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, []);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".wrangler")), true);
  assert.ok(writes.join("").includes("Worker deletion cancelled."));
  assert.ok(writes.join("").includes("Clean-all cancelled. Local files were left unchanged."));
  assert.ok(writes.join("").includes("urthreads backout clean-all --yes"));
  assert.ok(writes.join("").includes("urthreads backout delete-worker --name urthreads-worker"));
  assert.ok(writes.join("").includes("wrangler d1 list"));
});

test("clean-all stops when D1 database deletion confirmation is cancelled", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(
    path.join(tempDir, "wrangler.toml"),
    'name = "urthreads-worker"\n\n[[d1_databases]]\ndatabase_name = "threads-db"\n',
    "utf8"
  );
  fs.mkdirSync(path.join(tempDir, "dist"));
  const calls = [];
  const { writes, output } = makeOutput();

  await main(["clean-all"], {
    cwd: tempDir,
    output,
    prompter: makePrompter([true, "delete urthreads-worker", true, "nope"]),
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, [
    { command: "wrangler", args: ["delete", "urthreads-worker"] },
  ]);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "dist")), true);
  assert.ok(writes.join("").includes("D1 database deletion cancelled."));
  assert.ok(writes.join("").includes("Clean-all cancelled. Local files were left unchanged."));
  assert.ok(writes.join("").includes("urthreads backout clean-all --yes"));
  assert.ok(!writes.join("").includes("urthreads backout delete-worker --name urthreads-worker"));
  assert.ok(writes.join("").includes("wrangler d1 delete threads-db"));
});

test("infers worker name from wrangler toml before env file", () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=from-env\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "from-wrangler"\n', "utf8");

  assert.strictEqual(inferWorkerName(parseArgs(["delete-worker"]), tempDir), "from-wrangler");
});

test("infers database name from wrangler toml before env file", () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "D1_DATABASE_NAME=from-env\n", "utf8");
  fs.writeFileSync(
    path.join(tempDir, "wrangler.toml"),
    '[[d1_databases]]\ndatabase_name = "from-wrangler"\n',
    "utf8"
  );

  assert.strictEqual(inferDatabaseName(parseArgs(["delete-worker"]), tempDir), "from-wrangler");
});

test("delete worker requires exact confirmation text", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  const calls = [];
  const { writes, output } = makeOutput();

  await main(["delete-worker"], {
    cwd: tempDir,
    output,
    prompter: makePrompter(["nope"]),
    runner: (...args) => {
      calls.push(args);
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, []);
  assert.ok(writes.join("").includes("Worker deletion cancelled."));
});

test("delete worker runs wrangler and offers full local cleanup after confirmation", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.mkdirSync(path.join(tempDir, ".wrangler"));
  fs.writeFileSync(
    path.join(tempDir, "wrangler.toml"),
    'name = "urthreads-worker"\n\n[env.production]\nname = "urthreads-worker-prod"\n',
    "utf8"
  );
  const calls = [];

  await main(["delete-worker", "--env", "production"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter(["delete urthreads-worker-prod", true, true]),
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, [
    { command: "wrangler", args: ["delete", "urthreads-worker-prod", "--env", "production"] },
  ]);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), false);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".wrangler")), false);
});

test("delete worker can also delete inferred D1 database after confirmation", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(
    path.join(tempDir, "wrangler.toml"),
    'name = "urthreads-worker"\n\n[[d1_databases]]\ndatabase_name = "threads-db"\n',
    "utf8"
  );
  const calls = [];

  await main(["delete-worker", "--keep-local"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter(["delete urthreads-worker", true, "delete database threads-db"]),
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, [
    { command: "wrangler", args: ["delete", "urthreads-worker"] },
    { command: "wrangler", args: ["d1", "delete", "threads-db"] },
  ]);
});

test("delete worker can leave local files unchanged", async () => {
  const tempDir = makeTempDir();
  fs.writeFileSync(path.join(tempDir, ".env"), "WORKER_NAME=urthreads-worker\n", "utf8");
  fs.writeFileSync(path.join(tempDir, "wrangler.toml"), 'name = "urthreads-worker"\n', "utf8");
  const calls = [];

  await main(["delete-worker", "--keep-local"], {
    cwd: tempDir,
    output: { write: () => {} },
    prompter: makePrompter(["delete urthreads-worker"]),
    runner: (command, args) => {
      calls.push({ command, args });
      return { status: 0 };
    },
  });

  assert.deepStrictEqual(calls, [
    { command: "wrangler", args: ["delete", "urthreads-worker"] },
  ]);
  assert.strictEqual(fs.existsSync(path.join(tempDir, ".env")), true);
  assert.strictEqual(fs.existsSync(path.join(tempDir, "wrangler.toml")), true);
});
