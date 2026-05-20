#!/usr/bin/env node

/**
 * Public CLI entrypoint for the cflc package.
 */

const moderationCli = require("./cli");
const setupEnvCli = require("./setup-env");

const MODERATION_COMMANDS = new Set([
  "pending",
  "approve",
  "reject",
  "list-approved",
  "stats",
  "health",
]);

const SETUP_COMMANDS = new Set([
  "setup-env",
  "setup:env",
  "env",
  "init",
]);

function showHelp() {
  process.stdout.write(`
cflc - Cloudflare Likes & Comments

USAGE:
  cflc <command> [params]

SETUP COMMANDS:
  setup-env            Create a local .env file with guided prompts
  init                 Alias for setup-env

COMMENT MANAGEMENT:
  pending              List all pending comments
  approve <id>         Approve a comment by ID
  reject <id>          Reject a comment by ID
  list-approved <path> List approved comments for a post path
  stats                Show database statistics
  health               Run a D1 health check

HELP:
  help                 Show this help message
  setup-env --help     Show .env setup help
  comments help        Show comment management help

EXAMPLES:
  cflc setup-env
  cflc pending
  cflc approve 5
  cflc list-approved /blog/my-post

`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (SETUP_COMMANDS.has(command)) {
    await setupEnvCli.main(argv.slice(1), { commandName: `cflc ${command}` });
    return;
  }

  if (command === "comments") {
    await moderationCli.main(argv.slice(1), { commandName: "cflc comments" });
    return;
  }

  if (MODERATION_COMMANDS.has(command)) {
    await moderationCli.main(argv, { commandName: "cflc" });
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run 'cflc help' for usage.");
  process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
  main,
  showHelp,
};
