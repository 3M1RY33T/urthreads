#!/usr/bin/env node

/**
 * Configure the dashboard admin session lifetime in .env.
 */

const path = require("path");
const readline = require("readline");
const { writeEnvFile } = require("./admin-key");
const { formatHelp } = require("./help-format");

const ADMIN_SESSION_TTL_SECONDS_NAME = "ADMIN_SESSION_TTL_SECONDS";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;
const MIN_SESSION_TTL_SECONDS = 15 * 60;
const MAX_SESSION_TTL_SECONDS = 60 * 60;

function normalizeTtlUnit(value) {
  const unit = String(value || "").toLowerCase();
  if (!unit || unit === "s" || unit.startsWith("sec")) return "s";
  if (unit === "m" || unit === "min" || unit.startsWith("minute")) return "m";
  if (unit === "h" || unit === "hr" || unit.startsWith("hour")) return "h";
  if (unit === "d" || unit.startsWith("day")) return "d";
  return "";
}

function parseSessionTtlValue(value) {
  const text = String(value || "").trim().toLowerCase();
  if (!text || text === "default") return DEFAULT_SESSION_TTL_SECONDS;

  const match = text.match(/^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)?$/i);
  if (!match) {
    throw new Error("Session TTL must be seconds or a duration like 15m, 30m, or 1h.");
  }

  const amount = Number(match[1]);
  const unit = normalizeTtlUnit(match[2]);
  if (!Number.isInteger(amount) || amount <= 0 || !unit) {
    throw new Error("Session TTL must be a positive duration.");
  }

  const multiplier = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 24 * 60 * 60,
  }[unit];
  const seconds = amount * multiplier;

  if (seconds < MIN_SESSION_TTL_SECONDS || seconds > MAX_SESSION_TTL_SECONDS) {
    throw new Error("Session TTL must be between 15 minutes and 1 hour.");
  }

  return seconds;
}

function parseArgs(argv = []) {
  const result = {
    envPath: ".env",
    help: false,
    ttl: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h" || arg === "help") {
      result.help = true;
    } else if (arg === "--env") {
      result.envPath = argv[index + 1] || result.envPath;
      index += 1;
    } else if (arg.startsWith("--env=")) {
      result.envPath = arg.slice("--env=".length);
    } else if (arg === "--ttl") {
      result.ttl = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--ttl=")) {
      result.ttl = arg.slice("--ttl=".length);
    } else if (!result.ttl) {
      result.ttl = arg;
    }
  }

  return result;
}

function createPrompter(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });

  function ask(question, defaultValue = "") {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    return new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, (answer) => {
        const value = answer.trim();
        resolve(value || defaultValue);
      });
    });
  }

  return {
    ask,
    close: () => rl.close(),
  };
}

async function selectSessionTtl(prompter, output = process.stdout) {
  output.write("\nHow long should dashboard admin sessions last?\n");
  output.write("  1. 15 minutes\n");
  output.write("  2. 30 minutes\n");
  output.write("  3. 1 hour\n");
  output.write("  4. Custom duration\n\n");

  const choice = await prompter.ask("Select an option", "3");

  if (choice === "1") return parseSessionTtlValue("15m");
  if (choice === "2") return parseSessionTtlValue("30m");
  if (choice === "3") return parseSessionTtlValue("1h");
  if (choice === "4") {
    const customValue = await prompter.ask("Enter duration (30m, 1h, seconds)", "1h");
    return parseSessionTtlValue(customValue);
  }

  return parseSessionTtlValue(choice);
}

function showHelp(commandName = "node src/admin-session.js") {
  process.stdout.write(formatHelp(`
urthreads Admin Session Config

USAGE:
  ${commandName}
  ${commandName} --ttl <seconds|15m|30m|1h>
  ${commandName} --env ./path/to/.env --ttl 30m

DESCRIPTION:
  Writes ADMIN_SESSION_TTL_SECONDS to .env. This controls how long dashboard
  admin sessions last after the admin key is submitted to /admin/session.
  Values are limited to 15 minutes through 1 hour.

`));
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/admin-session.js";
  const output = options.output || process.stdout;
  const args = parseArgs(argv);

  if (args.help) {
    showHelp(commandName);
    return;
  }

  const prompter = options.prompter || createPrompter();

  try {
    const ttlSeconds = args.ttl
      ? parseSessionTtlValue(args.ttl)
      : await selectSessionTtl(prompter, output);
    const envPath = path.resolve(process.cwd(), args.envPath);

    writeEnvFile(envPath, {
      [ADMIN_SESSION_TTL_SECONDS_NAME]: String(ttlSeconds),
    });

    output.write(`\nUpdated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    output.write(`${ADMIN_SESSION_TTL_SECONDS_NAME}=${ttlSeconds}\n\n`);
    output.write("Next steps:\n");
    output.write("  1. Add/update ADMIN_SESSION_TTL_SECONDS in your Worker environment.\n");
    output.write("  2. Redeploy the Worker so the new session lifetime is active.\n\n");
  } finally {
    if (!options.prompter) {
      prompter.close();
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/admin-session.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  ADMIN_SESSION_TTL_SECONDS_NAME,
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  MIN_SESSION_TTL_SECONDS,
  main,
  parseArgs,
  parseSessionTtlValue,
  showHelp,
};
