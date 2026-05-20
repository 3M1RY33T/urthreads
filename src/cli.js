#!/usr/bin/env node

/**
 * CLI tool for managing pending comments in Cloudflare D1
 * 
 * Usage:
 *   node cli.js pending              - List all pending comments
 *   node cli.js approve <id>         - Approve a comment
 *   node cli.js reject <id>          - Reject a comment
 *   node cli.js list-approved <path> - List approved comments for a post
 *   node cli.js stats                - Show database statistics
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

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
function parseArgs() {
  const args = process.argv.slice(2);
  return {
    command: args[0],
    params: args.slice(1),
  };
}

/**
 * Generate the wrangler command to execute
 */
function generateWranglerCommand(sqlQuery, dbName) {
  return `wrangler d1 execute ${dbName} --remote --command "${sqlQuery.replace(/"/g, '\\"')}"`;
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
  WHERE path = '${postPath}' AND status = 'approved' 
  ORDER BY created_at ASC`;
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
function showHelp() {
  log(`
Cloudflare Likes & Comments CLI - Comment Management Tool

USAGE:
  node cli.js <command> [params]

COMMANDS:
  pending              List all pending comments
  approve <id>         Approve a comment by ID
  reject <id>          Reject a comment by ID
  list-approved <path> List approved comments for a post path
  stats                Show database statistics
  health               Run a D1 health check for the configured database
  help                 Show this help message

EXAMPLES:
  # List pending comments
  node cli.js pending

  # Approve comment with ID 5
  node cli.js approve 5

  # List approved comments for a post
  node cli.js list-approved /blog/my-post

  # Show database statistics
  node cli.js stats

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
  node cli.js health
  `, "cyan");
}

/**
 * Main CLI handler
 */
async function main() {
  const { command, params } = parseArgs();

  if (!command || command === "help") {
    showHelp();
    return;
  }

  // Read environment or get from args
  let dbName = process.env.D1_DATABASE_NAME;

  if (!dbName) {
    log("\n⚠️  D1_DATABASE_NAME environment variable not set", "yellow");
    log("Set it with: export D1_DATABASE_NAME=your-db-name", "yellow");
    log("Or pass it in: D1_DATABASE_NAME=your-db-name node cli.js pending\n", "yellow");
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
      if (!params[0] || isNaN(params[0])) {
        error("Comment ID required: node cli.js approve <id>");
      }
      sqlQuery = getSqlApproveComment(params[0]);
      description = `Approving comment #${params[0]}...`;
      break;

    case "reject":
      if (!params[0] || isNaN(params[0])) {
        error("Comment ID required: node cli.js reject <id>");
      }
      sqlQuery = getSqlRejectComment(params[0]);
      description = `Rejecting comment #${params[0]}...`;
      break;

    case "list-approved":
      if (!params[0]) {
        error("Post path required: node cli.js list-approved <path>");
      }
      sqlQuery = getSqlApprovedForPath(params[0]);
      description = `Listing approved comments for ${params[0]}...`;
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
      error(`Unknown command: ${command}\nRun 'node cli.js help' for usage`);
  }

  log("\n" + description, "blue");
  
  const fullCmd = `D1_DATABASE_NAME=${dbName} wrangler d1 execute ${dbName} --remote --command "${sqlQuery.replace(/"/g, '\\"')}"`;

  if (command === "health") {
    log("\nRunning health check...", "blue");
    try {
      const output = execSync(fullCmd, { encoding: "utf-8", stdio: "pipe" });
      log("Health check succeeded:\n" + output, "green");
      return;
    } catch (error) {
      error(`Health check failed: ${error.message}`);
    }
  }

  const wranglerCmd = generateWranglerCommand(sqlQuery, dbName);
  log("\nExecuting: " + wranglerCmd, "cyan");
  log("\nNote: Copy-paste the command above if you prefer to run it manually", "yellow");
  log("Or run this to execute directly:\n", "yellow");
  log(fullCmd, "green");
  log("\n");
}

if (require.main === module) {
  main().catch(error);
}

module.exports = {
  generateWranglerCommand,
  getSqlPendingComments,
  getSqlApproveComment,
  getSqlRejectComment,
  getSqlApprovedForPath,
  getSqlStats,
  getSqlHealthCheck,
};