const assert = require("assert");
const { test } = require("node:test");
const {
  generateWranglerCommand,
  getSqlPendingComments,
  getSqlApproveComment,
  getSqlRejectComment,
  getSqlApprovedForPath,
  getSqlCreateComment,
  getSqlDeleteComment,
  getSqlDeleteLike,
  getSqlGetComment,
  getSqlGetLike,
  getSqlIncrementLike,
  getSqlListComments,
  getSqlListLikes,
  getSqlResetCommentLikes,
  getSqlResetLikes,
  getSqlSetCommentStatus,
  getSqlSetLike,
  getSqlUpdateComment,
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
  const createSql = getSqlCreateComment({
    postPath: "/blog/test",
    pageUrl: "https://example.com/test",
    pageTitle: "Test Post",
    authorName: "Ada",
    content: "This is Ada's note",
    email: "ada@example.com",
  });

  assert.ok(createSql.includes("INSERT INTO post_comments"));
  assert.ok(createSql.includes("'This is Ada''s note'"));
  assert.ok(getSqlGetComment(5).includes("WHERE id = 5"));
  assert.ok(getSqlListComments("pending", "/blog/test").includes("status = 'pending'"));
  assert.ok(getSqlUpdateComment(5, "Updated").includes("SET content = 'Updated'"));
  assert.ok(getSqlSetCommentStatus(5, "approved").includes("status = 'approved'"));
  assert.ok(getSqlDeleteComment(5).includes("WHERE id = 5"));
  assert.ok(getSqlResetCommentLikes(5).includes("likes_count = 0"));
});

test("builds like CRUD queries", () => {
  assert.ok(getSqlListLikes(10).includes("LIMIT 10"));
  assert.ok(getSqlGetLike("/blog/test").includes("WHERE path = '/blog/test'"));
  assert.ok(getSqlSetLike("/blog/test", 4).includes("count = 4"));
  assert.ok(getSqlIncrementLike("/blog/test", 2).includes("count = count + 2"));
  assert.ok(getSqlDeleteLike("/blog/test").includes("DELETE FROM post_likes"));
  assert.strictEqual(getSqlResetLikes(), "DELETE FROM post_likes");
});
