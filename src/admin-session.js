#!/usr/bin/env node

/**
 * Configure the dashboard admin session lifetime in .env.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { writeEnvFile } = require("./admin-key");
const { formatHelp } = require("./help-format");
const { updateWranglerToml } = require("./wrangler-config");

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
    wranglerPath: "wrangler.toml",
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
    } else if (arg === "--toml" || arg === "--wrangler") {
      result.wranglerPath = argv[index + 1] || result.wranglerPath;
      index += 1;
    } else if (arg.startsWith("--toml=")) {
      result.wranglerPath = arg.slice("--toml=".length);
    } else if (arg.startsWith("--wrangler=")) {
      result.wranglerPath = arg.slice("--wrangler=".length);
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

  async function confirm(question, defaultValue = true) {
    const label = defaultValue ? "Y/n" : "y/N";
    const answer = String(await ask(`${question} [${label}]`)).toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  }

  return {
    ask,
    confirm,
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

function commandSucceeded(result) {
  return !result?.error && (typeof result?.status !== "number" || result.status === 0);
}

function getCommandOutput(result) {
  return `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
}

function summarizeWranglerFailure(output) {
  const text = String(output || "").toLowerCase();
  if (text.includes("not authenticated") || text.includes("cloudflare_api_token")) {
    return "Wrangler is not authenticated for this command.";
  }
  if (text.includes("permission") || text.includes("forbidden") || text.includes("unauthorized")) {
    return "Wrangler does not have permission to complete this command.";
  }
  return "Wrangler could not complete the command.";
}

function displayLocalPath(filePath, fallbackName) {
  const relative = path.relative(process.cwd(), filePath);
  if (!relative) return fallbackName;
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return path.basename(filePath) || fallbackName;
  }
  return relative;
}

function updateAdminSessionTtlInWranglerToml(wranglerPath, ttlSeconds) {
  if (!fs.existsSync(wranglerPath)) {
    return {
      ok: false,
      missing: true,
    };
  }

  let content = fs.readFileSync(wranglerPath, "utf8");
  for (const envName of ["default", "production", "staging"]) {
    content = updateWranglerToml(content, ADMIN_SESSION_TTL_SECONDS_NAME, String(ttlSeconds), envName);
  }
  fs.writeFileSync(wranglerPath, content, "utf8");

  return {
    ok: true,
    missing: false,
  };
}

function deployWorker(options = {}) {
  const runner = options.runner || spawnSync;
  const result = runner("wrangler", ["deploy"], {
    encoding: "utf8",
    stdio: "pipe",
  });

  return {
    ok: commandSucceeded(result),
    output: getCommandOutput(result),
  };
}

async function offerWorkerDeploy(prompter, output = process.stdout, options = {}) {
  if (options.useWrangler === false || !prompter?.confirm) return false;

  const shouldDeploy = await prompter.confirm(
    "Deploy Worker now so the new session lifetime is active?",
    false
  );
  if (!shouldDeploy) return false;

  output.write("Deploying Worker...\n");
  const deployResult = deployWorker(options);
  if (deployResult.ok) {
    output.write("Deployed Worker.\n");
    return true;
  }

  output.write("Worker deployment did not complete.\n");
  output.write(`${summarizeWranglerFailure(deployResult.output)}\n`);
  if (deployResult.output) {
    output.write("Wrangler detail:\n");
    output.write(`${deployResult.output}\n`);
  }
  return false;
}

function showHelp(commandName = "node src/admin-session.js") {
  process.stdout.write(formatHelp(`
urthreads Admin Session Config

USAGE:
  ${commandName}
  ${commandName} --ttl <seconds|15m|30m|1h>
  ${commandName} --env ./path/to/.env --ttl 30m
  ${commandName} --toml ./wrangler.toml --ttl 30m

DESCRIPTION:
  Writes ADMIN_SESSION_TTL_SECONDS to .env and wrangler.toml when available.
  This controls how long dashboard admin sessions last after the admin key is
  submitted to /admin/session. Values are limited to 15 minutes through 1 hour.

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

  const shouldClosePrompter = !Object.prototype.hasOwnProperty.call(options, "prompter");
  const prompter = shouldClosePrompter
    ? createPrompter()
    : options.prompter;

  try {
    const ttlSeconds = args.ttl
      ? parseSessionTtlValue(args.ttl)
      : await selectSessionTtl(prompter, output);
    const envPath = path.resolve(process.cwd(), args.envPath);
    const wranglerPath = path.resolve(process.cwd(), args.wranglerPath);
    const wranglerDisplayPath = displayLocalPath(wranglerPath, "wrangler.toml");

    writeEnvFile(envPath, {
      [ADMIN_SESSION_TTL_SECONDS_NAME]: String(ttlSeconds),
    });

    output.write(`\nUpdated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    const wranglerUpdate = updateAdminSessionTtlInWranglerToml(wranglerPath, ttlSeconds);
    if (wranglerUpdate.ok) {
      output.write(`Updated ${wranglerDisplayPath}\n`);
    } else {
      output.write(`${wranglerDisplayPath} was not found, so ${ADMIN_SESSION_TTL_SECONDS_NAME} was not updated there.\n`);
    }
    output.write(`${ADMIN_SESSION_TTL_SECONDS_NAME}=${ttlSeconds}\n\n`);

    const deployed = wranglerUpdate.ok
      ? await offerWorkerDeploy(prompter, output, options)
      : false;

    output.write("\n");
    output.write("Next steps:\n");
    if (!wranglerUpdate.ok) {
      output.write(`  1. Update the Worker session TTL: urthreads wrangler set ${ADMIN_SESSION_TTL_SECONDS_NAME} ${ttlSeconds}\n`);
      output.write("  2. Deploy the Worker: wrangler deploy\n\n");
    } else if (!deployed) {
      output.write("  1. Deploy the Worker: wrangler deploy\n\n");
    } else {
      output.write("  1. Open the dashboard and sign in again when you are ready.\n\n");
    }
  } finally {
    if (shouldClosePrompter) {
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
  deployWorker,
  main,
  parseArgs,
  parseSessionTtlValue,
  updateAdminSessionTtlInWranglerToml,
  showHelp,
};
