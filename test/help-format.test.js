const assert = require("assert");
const { test } = require("node:test");
const { ANSI, formatHelp, supportsColor } = require("../src/help-format");

const sampleHelp = `
urthreads Example

USAGE:
  urthreads example <path> [--dry-run]
`;

function stripAnsi(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, "");
}

test("does not color help output for non-tty streams", () => {
  assert.strictEqual(formatHelp(sampleHelp, { stream: { isTTY: false }, env: {} }), sampleHelp);
});

test("colors help output for tty streams", () => {
  const output = formatHelp(sampleHelp, { stream: { isTTY: true }, env: {} });

  assert.ok(output.includes("\x1b["));
  assert.ok(output.includes("urthreads Example"));
  assert.ok(output.includes("--dry-run"));
  assert.ok(!stripAnsi(output).includes("[35m"));
});

test("colors command columns consistently", () => {
  const output = formatHelp(`
COMMANDS:
  setup-env            Create a local .env file
  wrangler-init        Create wrangler.toml
  approve <id>         Approve a comment
`, { stream: { isTTY: true }, env: {} });

  assert.ok(output.includes(`${ANSI.green}setup-env${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.green}wrangler-init${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.green}approve${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.magenta}<id>${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.dim}Create a local .env file${ANSI.reset}`));
});

test("keeps long command descriptions dimmed", () => {
  const output = formatHelp(`
COMMANDS:
  list-approved <path> List approved comments for a post path
`, { stream: { isTTY: true }, env: {} });

  assert.ok(output.includes(`${ANSI.green}list-approved${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.magenta}<path>${ANSI.reset}`));
  assert.ok(output.includes(`${ANSI.dim}List approved comments for a post path${ANSI.reset}`));
});

test("respects NO_COLOR and dumb terminals", () => {
  assert.strictEqual(supportsColor({ isTTY: true }, { NO_COLOR: "1" }), false);
  assert.strictEqual(supportsColor({ isTTY: true }, { TERM: "dumb" }), false);
});
