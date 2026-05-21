#!/usr/bin/env node

/**
 * Public CLI entrypoint for the thread-cf package.
 */

const moderationCli = require("./cli");
const adminKeyCli = require("./admin-key");
const setupEnvCli = require("./setup-env");

const MODERATION_COMMANDS = new Set([
  "pending",
  "approve",
  "reject",
  "list-approved",
  "list-comments",
  "get-comment",
  "create-comment",
  "update-comment",
  "set-comment-status",
  "delete-comment",
  "reset-comment-likes",
  "list-likes",
  "get-like",
  "set-like",
  "increment-like",
  "delete-like",
  "reset-likes",
  "stats",
  "health",
]);

const SETUP_COMMANDS = new Set([
  "setup-env",
  "setup:env",
  "env",
  "init",
]);

const ADMIN_KEY_COMMANDS = new Set([
  "admin-key",
  "api-key",
  "generate-admin-key",
  "rotate-admin-key",
]);

function showHelp() {
  process.stdout.write(`
thread-cf - Cloudflare Likes & Comments

USAGE:
  thread-cf <command> [params]

SETUP COMMANDS:
  setup-env            Create a local .env file with guided prompts
  init                 Alias for setup-env
  admin-key            Generate/rotate ADMIN_API_KEY in .env

COMMENT MANAGEMENT:
  pending              List all pending comments
  approve <id>         Approve a comment by ID
  reject <id>          Reject a comment by ID
  list-approved <path> List approved comments for a post path
  list-comments        List comments by status/path
  create-comment       Create a comment
  update-comment       Update comment content
  delete-comment       Delete a comment
  reset-comment-likes  Reset likes on a comment

LIKE MANAGEMENT:
  list-likes           List top liked paths
  get-like <path>      Show likes for a path
  set-like <path> <n>  Create/update like count for a path
  increment-like       Increment like count for a path
  delete-like          Delete likes for a path
  reset-likes          Delete all path likes

GENERAL:
  stats                Show database statistics
  health               Run a D1 health check

HELP:
  help                 Show this help message
  setup-env --help     Show .env setup help
  comments help        Show comment management help

EXAMPLES:
  thread-cf setup-env
  thread-cf admin-key
  thread-cf admin-key --expires 30d
  thread-cf pending
  thread-cf approve 5
  thread-cf list-approved /blog/my-post
  thread-cf list-likes
  thread-cf set-like /blog/my-post 10 --execute

`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (SETUP_COMMANDS.has(command)) {
    await setupEnvCli.main(argv.slice(1), { commandName: `thread-cf ${command}` });
    return;
  }

  if (ADMIN_KEY_COMMANDS.has(command)) {
    await adminKeyCli.main(argv.slice(1), { commandName: `thread-cf ${command}` });
    return;
  }

  if (command === "comments") {
    await moderationCli.main(argv.slice(1), { commandName: "thread-cf comments" });
    return;
  }

  if (MODERATION_COMMANDS.has(command)) {
    await moderationCli.main(argv, { commandName: "thread-cf" });
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run 'thread-cf help' for usage.");
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  ADMIN_KEY_COMMANDS,
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
  main,
  showHelp,
};
