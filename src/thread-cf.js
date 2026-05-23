#!/usr/bin/env node

/**
 * Public CLI entrypoint for the urthreads package.
 */

const moderationCli = require("./cli");
const adminKeyCli = require("./admin-key");
const adminSessionCli = require("./admin-session");
const envConfigCli = require("./env-config");
const setupEnvCli = require("./setup-env");
const wranglerConfigCli = require("./wrangler-config");

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
  "init",
]);

const ADMIN_KEY_COMMANDS = new Set([
  "admin-key",
  "api-key",
  "generate-admin-key",
  "rotate-admin-key",
]);

const ADMIN_SESSION_COMMANDS = new Set([
  "admin-session",
  "session-ttl",
  "admin-session-ttl",
]);

const ENV_COMMANDS = new Set([
  "env",
  "origin",
  "origins",
  "allowed-origin",
  "allowed-origins",
]);

const WRANGLER_COMMANDS = new Set([
  "wrangler",
  "wrangler-init",
  "wrangler-toml",
]);

function showHelp() {
  process.stdout.write(`
urthreads - Cloudflare Likes & Comments

USAGE:
  urthreads <command> [params]

SETUP COMMANDS:
  setup-env            Create a local .env file with guided prompts
  init                 Alias for setup-env
  wrangler-init        Create wrangler.toml with guided prompts
  wrangler             Manage wrangler.toml values
  env                  Manage local .env values
  env add-origin       Add exact allowed origins to .env
  env open             Open .env in the system text viewer
  admin-key            Generate/rotate ADMIN_API_KEY in .env
  admin-session        Configure ADMIN_SESSION_TTL_SECONDS in .env

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
  urthreads setup-env
  urthreads wrangler-init
  urthreads wrangler set database_id your-d1-id
  urthreads env add-origin http://localhost:8000
  urthreads env open
  urthreads admin-key
  urthreads admin-key --expires 30d
  urthreads admin-session --ttl 1h
  urthreads pending
  urthreads approve 5
  urthreads list-approved /blog/my-post
  urthreads list-likes
  urthreads set-like /blog/my-post 10 --execute

`);
}

async function main(argv = process.argv.slice(2)) {
  const command = argv[0];

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (SETUP_COMMANDS.has(command)) {
    await setupEnvCli.main(argv.slice(1), { commandName: `urthreads ${command}` });
    return;
  }

  if (ADMIN_KEY_COMMANDS.has(command)) {
    await adminKeyCli.main(argv.slice(1), { commandName: `urthreads ${command}` });
    return;
  }

  if (ADMIN_SESSION_COMMANDS.has(command)) {
    await adminSessionCli.main(argv.slice(1), { commandName: `urthreads ${command}` });
    return;
  }

  if (ENV_COMMANDS.has(command)) {
    let envArgs = argv.slice(1);
    if (command !== "env") {
      envArgs = envArgs[0] === "add"
        ? ["add-origin", ...envArgs.slice(1)]
        : ["add-origin", ...envArgs];
    }
    await envConfigCli.main(envArgs, { commandName: command === "env" ? "urthreads env" : `urthreads ${command}` });
    return;
  }

  if (WRANGLER_COMMANDS.has(command)) {
    const wranglerArgs = command === "wrangler-init" ? ["init", ...argv.slice(1)] : argv.slice(1);
    await wranglerConfigCli.main(wranglerArgs, { commandName: command === "wrangler" ? "urthreads wrangler" : `urthreads ${command}` });
    return;
  }

  if (command === "comments") {
    await moderationCli.main(argv.slice(1), { commandName: "urthreads comments" });
    return;
  }

  if (MODERATION_COMMANDS.has(command)) {
    await moderationCli.main(argv, { commandName: "urthreads" });
    return;
  }

  console.error(`Unknown command: ${command}`);
  console.error("Run 'urthreads help' for usage.");
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
  ADMIN_SESSION_COMMANDS,
  ENV_COMMANDS,
  MODERATION_COMMANDS,
  SETUP_COMMANDS,
  WRANGLER_COMMANDS,
  main,
  showHelp,
};
