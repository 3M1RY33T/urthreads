const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const {
  fetchApprovedComments,
  replaceCommentsBlock,
  renderCommentsMarkdown,
  syncReadmeComments,
} = require("../src/update-readme-comments");

test("renders approved comments as escaped markdown", () => {
  const markdown = renderCommentsMarkdown(
    [
      {
        authorName: "Ada_User",
        content: "Great <script>work</script>!\nThanks.",
        createdAt: "2026-05-20T10:30:00Z",
        replies: [
          {
            authorName: "Grace",
            content: "Reply with *markdown*",
            createdAt: "2026-05-21T10:30:00Z",
          },
        ],
      },
    ],
    { sourceUrl: "https://example.com/comments", limit: 5 }
  );

  assert.ok(markdown.includes("Ada\\_User · 2026-05-20"));
  assert.ok(markdown.includes("&lt;script&gt;work&lt;/script&gt;"));
  assert.ok(markdown.includes("Reply with \\*markdown\\*"));
  assert.ok(markdown.includes("[Leave a comment](https://example.com/comments)"));
});

test("replaces an existing comments block without touching surrounding content", () => {
  const readme = [
    "# Profile",
    "",
    "<!-- comments:start -->",
    "old comments",
    "<!-- comments:end -->",
    "",
    "after",
    "",
  ].join("\n");

  const updated = replaceCommentsBlock(readme, "- **Ada**: Hello");

  assert.ok(updated.includes("# Profile"));
  assert.ok(updated.includes("<!-- comments:start -->\n- **Ada**: Hello\n<!-- comments:end -->"));
  assert.ok(updated.includes("\nafter\n"));
  assert.ok(!updated.includes("old comments"));
});

test("appends a comments block when markers are missing", () => {
  const updated = replaceCommentsBlock("# Profile\n", "_No comments._", {
    heading: "## Guestbook",
  });

  assert.ok(updated.includes("## Guestbook"));
  assert.ok(updated.includes("<!-- comments:start -->\n_No comments._\n<!-- comments:end -->"));
});

test("throws when a README comments block has only one marker", () => {
  assert.throws(
    () => replaceCommentsBlock("# Profile\n<!-- comments:start -->\n", "_No comments._"),
    /missing either the start or end marker/
  );
});

test("fetches approved comments using the configured page id", async () => {
  let requestedUrl = "";
  const comments = await fetchApprovedComments(
    "https://worker.example/comments",
    "/profile",
    async (url) => {
      requestedUrl = url;
      return { comments: [{ id: 1, content: "Hi" }] };
    }
  );

  assert.strictEqual(comments.length, 1);
  assert.strictEqual(new URL(requestedUrl).searchParams.get("path"), "/profile");
});

test("syncs fetched comments into a README file", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cflc-readme-"));
  const readmePath = path.join(tmpDir, "README.md");

  fs.writeFileSync(
    readmePath,
    "# Profile\n\n<!-- comments:start -->\nold\n<!-- comments:end -->\n"
  );

  const result = await syncReadmeComments(
    {
      endpoint: "https://worker.example/comments",
      pageId: "/",
      readmePath,
      limit: 10,
      sourceUrl: "",
      startMarker: "<!-- comments:start -->",
      endMarker: "<!-- comments:end -->",
      emptyMessage: "_No approved comments yet._",
    },
    async () => ({
      comments: [
        {
          authorName: "Ada",
          content: "Hello profile",
          createdAt: "2026-05-20T10:30:00Z",
        },
      ],
    })
  );

  const updated = fs.readFileSync(readmePath, "utf8");
  assert.strictEqual(result.changed, true);
  assert.ok(updated.includes("Ada"));
  assert.ok(updated.includes("Hello profile"));
  assert.ok(!updated.includes("\nold\n"));
});
