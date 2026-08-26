#!/usr/bin/env node

/**
 * CLI tool for managing comments and likes in Cloudflare D1
 *
 * Usage:
 *   node cli.js pending              - List all pending comments
 *   node cli.js approve <id>         - Approve a comment
 *   node cli.js reject <id>          - Reject a comment
 *   node cli.js list-approved <path> - List approved comments for a post
 *   node cli.js stats                - Show database statistics
 */

const { spawnSync } = require("child_process");
const { formatHelp } = require("./help-format");

// Color codes for terminal output
const colors = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message, color = "reset") {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
  console.error(`${colors.red}Error: ${message}${colors.reset}`);
  process.exit(1);
}

/**
 * Parse command line arguments
 */
function parseArgs(argv = process.argv.slice(2)) {
  const args = argv.filter((arg) => arg !== "--execute" && arg !== "--run");
  return {
    command: args[0],
    params: args.slice(1),
    execute: argv.includes("--execute") || argv.includes("--run"),
  };
}

function sqlString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function requireId(value, label = "ID") {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    error(`${label} must be a positive integer`);
  }
  return id;
}

function requireCount(value, label = "Count") {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    error(`${label} must be a non-negative integer`);
  }
  return count;
}

function requirePath(value) {
  const postPath = String(value || "").trim();
  if (!postPath.startsWith("/")) {
    error("Path is required and must start with /");
  }
  return postPath;
}

function normalizeStatus(value, fallback = "all") {
  const status = String(value || fallback).trim();
  const allowed = new Set(["all", "pending", "approved", "rejected"]);
  if (!allowed.has(status)) {
    error("Status must be one of: all, pending, approved, rejected");
  }
  return status;
}

/**
 * Validate database name — reject anything that could enable command injection.
 * Only alphanumeric characters, underscores, and hyphens are allowed.
 */
function validateDbName(name) {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error("Invalid database name: only letters, numbers, underscores, and hyphens are allowed");
  }
  return name;
}

/**
 * Generate the wrangler command to execute (display only)
 */
function generateWranglerCommand(sqlQuery, dbName) {
  try {
    validateDbName(dbName);
  } catch (e) {
    error(e.message);
  }
  const escapedSql = sqlQuery.replace(/"/g, '\\"');
  return `wrangler d1 execute ${dbName} --remote --command "${escapedSql}"`;
}

/**
 * Build SQL query for listing pending comments
 */
function getSqlPendingComments() {
  return `SELECT
    id,
    path,
    parent_id,
    author_name,
    likes_count,
    substr(content, 1, 50) as preview,
    created_at,
    status
  FROM post_comments
  WHERE status = 'pending'
  ORDER BY created_at ASC`;
}

/**
 * Build SQL query to approve a comment
 */
function getSqlApproveComment(id) {
  return `UPDATE post_comments
    SET status = 'approved', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}`;
}

/**
 * Build SQL query to reject a comment
 */
function getSqlRejectComment(id) {
  return `UPDATE post_comments
    SET status = 'rejected', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}`;
}

/**
 * Build SQL query to list approved comments for a path
 */
function getSqlApprovedForPath(postPath) {
  return `SELECT
    id,
    parent_id,
    author_name,
    likes_count,
    substr(content, 1, 50) as preview,
    created_at
  FROM post_comments
  WHERE path = ${sqlString(postPath)} AND status = 'approved'
  ORDER BY created_at ASC`;
}

function getSqlListComments(status = "all", postPath = "") {
  const whereParts = [];

  if (status !== "all") {
    whereParts.push(`status = ${sqlString(status)}`);
  }

  if (postPath) {
    whereParts.push(`path = ${sqlString(postPath)}`);
  }

  const whereClause = whereParts.length > 0
    ? `WHERE ${whereParts.join(" AND ")}`
    : "";

  return `SELECT
    id,
    path,
    parent_id,
    page_url,
    page_title,
    author_name,
    author_email,
    likes_count,
    status,
    substr(content, 1, 80) as preview,
    created_at,
    updated_at
  FROM post_comments
  ${whereClause}
  ORDER BY created_at DESC, id DESC`;
}

function getSqlGetComment(id) {
  return `SELECT *
  FROM post_comments
  WHERE id = ${id}`;
}

function getSqlSetCommentStatus(id, status) {
  return `UPDATE post_comments
    SET status = ${sqlString(status)},
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}`;
}

function getSqlDeleteComment(id) {
  return `DELETE FROM post_comments
    WHERE id = ${id}`;
}

function getSqlResetCommentLikes(id) {
  return `UPDATE post_comments
    SET likes_count = 0,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ${id}`;
}

function getSqlListLikes(limit = 25) {
  return `SELECT path, count, updated_at
  FROM post_likes
  ORDER BY count DESC, updated_at DESC
  LIMIT ${limit}`;
}

function getSqlGetLike(postPath) {
  return `SELECT path, count, updated_at
  FROM post_likes
  WHERE path = ${sqlString(postPath)}`;
}

function getSqlDeleteLike(postPath) {
  return `DELETE FROM post_likes
  WHERE path = ${sqlString(postPath)}`;
}

function getSqlResetLikes() {
  return "DELETE FROM post_likes";
}

/**
 * Build SQL query for database statistics
 */
function getSqlStats() {
  return `SELECT
    'total_likes' as metric,
    CAST(COUNT(*) as TEXT) as value
  FROM post_likes
  UNION ALL
  SELECT
    'total_comments',
    CAST(COUNT(*) as TEXT)
  FROM post_comments
  UNION ALL
  SELECT
    'pending_comments',
    CAST(COUNT(*) as TEXT)
  FROM post_comments
  WHERE status = 'pending'
  UNION ALL
  SELECT
    'approved_comments',
    CAST(COUNT(*) as TEXT)
  FROM post_comments
  WHERE status = 'approved'
  UNION ALL
  SELECT
    'rejected_comments',
    CAST(COUNT(*) as TEXT)
  FROM post_comments
  WHERE status = 'rejected'`;
}

function getSqlHealthCheck() {
  return `SELECT 1 as ok`;
}

/**
 * Display help message
 */
function showHelp(commandName = "node src/cli.js") {
  console.log(formatHelp(`
urthreads CLI - Comment Management Tool

USAGE:
  ${commandName} <command> [params]

COMMANDS:
  # Comments
  pending              List all pending comments
  approve <id>         Approve a comment by ID
  reject <id>          Reject a comment by ID
  list-approved <path> List approved comments for a post path
  list-comments [status] [path]
                       List comments by status/path
  get-comment <id>     Show a full comment row
  set-comment-status <id> <pending|approved|rejected>
                       Set comment status
  delete-comment <id>  Delete a comment row
  reset-comment-likes <id>
                       Reset likes for one comment

  # Likes
  list-likes [limit]   List top liked paths
  get-like <path>      Show likes for a path
  delete-like <path>   Delete likes for a path
  reset-likes          Delete all path likes

  # General
  stats                Show database statistics
  health               Run a D1 health check for the configured database
  --execute, --run     Execute the generated Wrangler command
  help                 Show this help message

PREREQUISITES:
  - Cloudflare CLI (wrangler) must be installed and configured
  - Your D1 database must be set up with the schema.sql
  - You must have proper Cloudflare credentials configured

WRANGLER SETUP:
  1. Install: npm install -g @cloudflare/wrangler
  2. Login: wrangler login
  3. Create D1 database: wrangler d1 create your-db-name
  4. Initialize schema: wrangler d1 execute your-db-name --remote --file=src/schema.sql

DATABASE COMMANDS (Advanced):
  If you want to run raw SQL commands, you can use wrangler directly:

  wrangler d1 execute <db-name> --remote --command "SELECT * FROM post_comments WHERE status = 'pending'"

  # Health check
  ${commandName} health
  `));
}

/**
 * Main CLI handler
 */
async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/cli.js";
  const { command, params, execute } = parseArgs(argv);

  if (!command || command === "help") {
    showHelp(commandName);
    return;
  }

  // Read environment or get from args
  let dbName = process.env.D1_DATABASE_NAME;

  if (!dbName) {
    log("\n⚠️  D1_DATABASE_NAME environment variable not set", "yellow");
    log("Set it with: export D1_DATABASE_NAME=your-db-name", "yellow");
    log(`Or pass it in: D1_DATABASE_NAME=your-db-name ${commandName} pending\n`, "yellow");
    error("Database name is required");
  }

  let sqlQuery = "";
  let description = "";

  switch (command) {
    case "pending":
      sqlQuery = getSqlPendingComments();
      description = "Listing pending comments...";
      break;

    case "approve":
      sqlQuery = getSqlApproveComment(requireId(params[0], "Comment ID"));
      description = `Approving comment #${params[0]}...`;
      break;

    case "reject":
      sqlQuery = getSqlRejectComment(requireId(params[0], "Comment ID"));
      description = `Rejecting comment #${params[0]}...`;
      break;

    case "list-approved":
      if (!params[0]) {
        error(`Post path required: ${commandName} list-approved <path>`);
      }
      sqlQuery = getSqlApprovedForPath(requirePath(params[0]));
      description = `Listing approved comments for ${params[0]}...`;
      break;

    case "list-comments": {
      const status = normalizeStatus(params[0] || "all");
      const postPath = params[1] ? requirePath(params[1]) : "";
      sqlQuery = getSqlListComments(status, postPath);
      description = "Listing comments...";
      break;
    }

    case "get-comment":
      sqlQuery = getSqlGetComment(requireId(params[0], "Comment ID"));
      description = `Getting comment #${params[0]}...`;
      break;

    case "set-comment-status": {
      if (!params[1]) {
        error(`Usage: ${commandName} set-comment-status <id> <pending|approved|rejected>`);
      }
      const status = normalizeStatus(params[1]);
      if (status === "all") {
        error("Comment status must be one of: pending, approved, rejected");
      }
      sqlQuery = getSqlSetCommentStatus(requireId(params[0], "Comment ID"), status);
      description = `Setting comment #${params[0]} to ${status}...`;
      break;
    }

    case "delete-comment":
      sqlQuery = getSqlDeleteComment(requireId(params[0], "Comment ID"));
      description = `Deleting comment #${params[0]}...`;
      break;

    case "reset-comment-likes":
      sqlQuery = getSqlResetCommentLikes(requireId(params[0], "Comment ID"));
      description = `Resetting likes for comment #${params[0]}...`;
      break;

    case "list-likes":
      sqlQuery = getSqlListLikes(params[0] ? requireCount(params[0], "Limit") : 25);
      description = "Listing top liked paths...";
      break;

    case "get-like":
      sqlQuery = getSqlGetLike(requirePath(params[0]));
      description = `Getting likes for ${params[0]}...`;
      break;

    case "delete-like":
      sqlQuery = getSqlDeleteLike(requirePath(params[0]));
      description = `Deleting likes for ${params[0]}...`;
      break;

    case "reset-likes":
      sqlQuery = getSqlResetLikes();
      description = "Deleting all path likes...";
      break;

    case "stats":
      sqlQuery = getSqlStats();
      description = "Fetching database statistics...";
      break;

    case "health":
      sqlQuery = getSqlHealthCheck();
      description = "Performing database health check...";
      break;

    default:
      error(`Unknown command: ${command}\nRun '${commandName} help' for usage`);
  }

  log("\n" + description, "blue");

  try {
    validateDbName(dbName);
  } catch (e) {
    error(e.message);
  }

  const cmdArgs = ["d1", "execute", dbName, "--remote", "--command", sqlQuery];

  if (command === "health" || execute) {
    log("\nRunning Wrangler command...", "blue");
    const runner = options.runner || spawnSync;
    const result = runner("wrangler", cmdArgs, {
      encoding: "utf-8",
      stdio: "pipe",
      env: { ...process.env, D1_DATABASE_NAME: dbName },
    });
    if (result.status !== 0) {
      log(result.stderr, "red");
      error(`Command failed with exit code ${result.status}`);
    }
    log("Command succeeded:\n" + result.stdout, "green");
    return;
  }

  const wranglerCmd = generateWranglerCommand(sqlQuery, dbName);
  log("\nExecuting: " + wranglerCmd, "cyan");
  log("\nNote: Copy-paste the command above if you prefer to run it manually", "yellow");
  log("Or run this to execute directly:\n", "yellow");
  log(`D1_DATABASE_NAME=${dbName} wrangler ${cmdArgs.join(" ")}`, "green");
  log("\n");
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/cli.js" }).catch(error);
}

module.exports = {
  main,
  parseArgs,
  showHelp,
  sqlString,
  validateDbName,
  generateWranglerCommand,
  getSqlPendingComments,
  getSqlApproveComment,
  getSqlRejectComment,
  getSqlApprovedForPath,
  getSqlListComments,
  getSqlGetComment,
  getSqlSetCommentStatus,
  getSqlDeleteComment,
  getSqlResetCommentLikes,
  getSqlListLikes,
  getSqlGetLike,
  getSqlDeleteLike,
  getSqlResetLikes,
  getSqlStats,
  getSqlHealthCheck,
};
