const assert = require("assert");
const { test } = require("node:test");
const {
  generateWranglerCommand,
  validateDbName,
  getSqlPendingComments,
  getSqlApproveComment,
  getSqlRejectComment,
  getSqlApprovedForPath,
  getSqlDeleteComment,
  getSqlDeleteLike,
  getSqlGetComment,
  getSqlGetLike,
  getSqlListComments,
  getSqlListLikes,
  getSqlResetCommentLikes,
  getSqlResetLikes,
  getSqlSetCommentStatus,
  getSqlStats,
  getSqlHealthCheck,
  sqlString,
} = require("../src/cli");

test("generates a wrangler command with escaped SQL", () => {
  const sql = "SELECT \"test\" as value";
  const cmd = generateWranglerCommand(sql, "my-db");

  assert.ok(cmd.includes("wrangler d1 execute my-db"));
  assert.ok(cmd.includes("\\\"test\\\""));
});

test("builds a health check SQL statement", () => {
  assert.strictEqual(getSqlHealthCheck().trim(), "SELECT 1 as ok");
});

test("builds approved comments query for a post path", () => {
  const path = "/blog/test-post";
  const sql = getSqlApprovedForPath(path);

  assert.ok(sql.includes(`WHERE path = '${path}' AND status = 'approved'`));
});

test("escapes SQL string values", () => {
  assert.strictEqual(sqlString("Ada's post"), "'Ada''s post'");
});

test("builds pending comments query", () => {
  const sql = getSqlPendingComments();
  assert.ok(sql.includes("WHERE status = 'pending'"));
});

test("builds stats query with all expected metrics", () => {
  const sql = getSqlStats();
  assert.ok(sql.includes("total_likes"));
  assert.ok(sql.includes("approved_comments"));
  assert.ok(sql.includes("rejected_comments"));
});

test("builds approve and reject queries with numeric comment ID", () => {
  assert.strictEqual(getSqlApproveComment(42).includes("WHERE id = 42"), true);
  assert.strictEqual(getSqlRejectComment(73).includes("WHERE id = 73"), true);
});

test("builds comment CRUD queries", () => {
  assert.ok(getSqlGetComment(5).includes("WHERE id = 5"));
  assert.ok(getSqlListComments("pending", "/blog/test").includes("status = 'pending'"));
  assert.ok(getSqlSetCommentStatus(5, "approved").includes("status = 'approved'"));
  assert.ok(getSqlDeleteComment(5).includes("WHERE id = 5"));
  assert.ok(getSqlResetCommentLikes(5).includes("likes_count = 0"));
});

test("builds like CRUD queries", () => {
  assert.ok(getSqlListLikes(10).includes("LIMIT 10"));
  assert.ok(getSqlGetLike("/blog/test").includes("WHERE path = '/blog/test'"));
  assert.ok(getSqlDeleteLike("/blog/test").includes("DELETE FROM post_likes"));
  assert.strictEqual(getSqlResetLikes(), "DELETE FROM post_likes");
});

test("validateDbName rejects names with semicolons", () => {
  assert.throws(() => validateDbName("db;rm -rf /"), /Invalid database name/);
});

test("validateDbName rejects names with pipe characters", () => {
  assert.throws(() => validateDbName("db|cat /etc/passwd"), /Invalid database name/);
});

test("validateDbName rejects names with dollar signs", () => {
  assert.throws(() => validateDbName("db$(whoami)"), /Invalid database name/);
});

test("validateDbName rejects names with backticks", () => {
  assert.throws(() => validateDbName("db`whoami`"), /Invalid database name/);
});

test("validateDbName rejects names with spaces", () => {
  assert.throws(() => validateDbName("my db"), /Invalid database name/);
});

test("validateDbName accepts valid names", () => {
  assert.strictEqual(validateDbName("my-db_name123"), "my-db_name123");
  assert.strictEqual(validateDbName("productionDB"), "productionDB");
  assert.strictEqual(validateDbName("test-db_v2"), "test-db_v2");
});

test("cli.js uses spawnSync instead of execSync", () => {
  const cliSource = require("fs").readFileSync(
    require("path").join(__dirname, "..", "src", "cli.js"),
    "utf-8",
  );
  assert.ok(cliSource.includes('require("child_process")'), 'should require child_process');
  assert.ok(cliSource.includes("spawnSync"), 'should use spawnSync');
  assert.ok(!cliSource.includes("execSync"), 'should not use execSync');
  assert.ok(!/execSync/.test(cliSource), 'should not use execSync');
});

test("spawnSync is used for command execution (mock test)", async () => {
  const { main } = require("../src/cli");
  let spawnCalled = false;
  let capturedArgs = null;

  const mockRunner = function (cmd, args, opts) {
    spawnCalled = true;
    capturedArgs = { cmd, args, opts };
    return { status: 0, stdout: "mock output", stderr: "" };
  };

  const origDbName = process.env.D1_DATABASE_NAME;
  process.env.D1_DATABASE_NAME = "test-db";

  try {
    await main(["stats", "--execute"], { commandName: "node src/cli", runner: mockRunner });
    assert.ok(spawnCalled, 'runner should have been called');
    assert.strictEqual(capturedArgs.cmd, "wrangler", 'should call wrangler');
    assert.ok(Array.isArray(capturedArgs.args), 'args should be an array, not a string');
    assert.ok(capturedArgs.args.includes("--remote"), 'args should include --remote');
    assert.ok(capturedArgs.args.includes("--command"), 'args should include --command flag');
    assert.ok(capturedArgs.opts.env.D1_DATABASE_NAME, 'env should include D1_DATABASE_NAME');
  } finally {
    if (origDbName !== undefined) {
      process.env.D1_DATABASE_NAME = origDbName;
    } else {
      delete process.env.D1_DATABASE_NAME;
    }
  }
});
