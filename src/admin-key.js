#!/usr/bin/env node

/**
 * Generate and rotate the admin API key used by the dashboard/admin endpoints.
 *
 * This script intentionally uses only Node built-ins so it can run immediately
 * after cloning the repository.
 */

const crypto = require("crypto");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { formatHelp } = require("./help-format");

const ADMIN_KEY_NAME = "ADMIN_API_KEY";
const ADMIN_KEY_EXPIRES_AT_NAME = "ADMIN_API_KEY_EXPIRES_AT";

function generateAdminApiKey(bytes = 32) {
  return crypto.randomBytes(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function addDuration(now, amount, unit) {
  const date = new Date(now.getTime());

  if (unit === "m") date.setUTCMinutes(date.getUTCMinutes() + amount);
  if (unit === "h") date.setUTCHours(date.getUTCHours() + amount);
  if (unit === "d") date.setUTCDate(date.getUTCDate() + amount);

  return date;
}

function normalizeDurationUnit(value) {
  const unit = String(value || "").toLowerCase();
  if (unit.startsWith("minute") || unit === "min" || unit === "m") return "m";
  if (unit.startsWith("hour") || unit === "hr" || unit === "h") return "h";
  if (unit.startsWith("day") || unit === "d") return "d";
  return "";
}

function parseExpirationValue(value, now = new Date()) {
  const text = String(value || "").trim();
  const normalized = text.toLowerCase();

  if (!text || normalized === "never" || normalized === "none" || normalized === "no") {
    return {
      expiresAt: "",
      label: "never",
    };
  }

  const durationMatch = text.match(/^(\d+)\s*(m|min|minute|minutes|h|hr|hour|hours|d|day|days)$/i);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = normalizeDurationUnit(durationMatch[2]);
    const expiresAt = addDuration(now, amount, unit);

    return {
      expiresAt: expiresAt.toISOString(),
      label: expiresAt.toISOString(),
    };
  }

  const parsedDate = new Date(text);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new Error("Expiration must be never, a duration like 30d, or an ISO date.");
  }

  if (parsedDate.getTime() <= now.getTime()) {
    throw new Error("Expiration must be in the future.");
  }

  return {
    expiresAt: parsedDate.toISOString(),
    label: parsedDate.toISOString(),
  };
}

function getEnvKey(line) {
  const match = String(line).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match ? match[1] : "";
}

function envLine(key, value) {
  return `${key}=${String(value ?? "")}`;
}

function upsertEnvVars(content, updates) {
  const rawContent = String(content || "");
  const lines = rawContent ? rawContent.split(/\r?\n/) : [];
  const hadFinalNewline = rawContent.endsWith("\n");
  const pendingKeys = new Set(Object.keys(updates));
  const writtenKeys = new Set();
  const output = [];

  for (const line of lines) {
    const key = getEnvKey(line);

    if (key && Object.prototype.hasOwnProperty.call(updates, key)) {
      if (!writtenKeys.has(key)) {
        output.push(envLine(key, updates[key]));
        writtenKeys.add(key);
        pendingKeys.delete(key);
      }
      continue;
    }

    output.push(line);
  }

  if (!hadFinalNewline && output.length > 0 && output[output.length - 1] === "") {
    output.pop();
  }

  if (pendingKeys.size > 0) {
    if (output.length > 0 && output[output.length - 1] !== "") {
      output.push("");
    }

    const hasAdminHeading = output.some((line) => /admin dashboard/i.test(line));
    if (!hasAdminHeading) {
      output.push("# Admin dashboard");
    }

    for (const key of Object.keys(updates)) {
      if (pendingKeys.has(key)) {
        output.push(envLine(key, updates[key]));
      }
    }
  }

  return `${output.join("\n").replace(/\n*$/g, "")}\n`;
}

function writeEnvFile(envPath, updates) {
  const existingContent = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";
  const nextContent = upsertEnvVars(existingContent, updates);

  fs.writeFileSync(envPath, nextContent, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(envPath, 0o600);
  } catch (error) {
    // Best-effort hardening for platforms that support POSIX modes.
  }
}

function copyToClipboard(value) {
  const text = String(value || "");
  if (!text) return { copied: false, command: "" };

  const candidates = process.platform === "darwin"
    ? [{ command: "pbcopy", args: [] }]
    : process.platform === "win32"
      ? [{ command: "clip", args: [] }]
      : [
          { command: "wl-copy", args: [] },
          { command: "xclip", args: ["-selection", "clipboard"] },
          { command: "xsel", args: ["--clipboard", "--input"] },
        ];

  for (const candidate of candidates) {
    const result = spawnSync(candidate.command, candidate.args, {
      input: text,
      encoding: "utf8",
      stdio: ["pipe", "ignore", "ignore"],
    });

    if (result.status === 0) {
      return { copied: true, command: candidate.command };
    }
  }

  return { copied: false, command: "" };
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

async function selectExpiration(prompter, output = process.stdout) {
  output.write("\nWhen should this admin key expire?\n");
  output.write("  1. Never\n");
  output.write("  2. In 7 days\n");
  output.write("  3. In 30 days\n");
  output.write("  4. In 90 days\n");
  output.write("  5. Custom duration or ISO date\n\n");

  const choice = await prompter.ask("Select an option", "1");

  if (choice === "1") return parseExpirationValue("never");
  if (choice === "2") return parseExpirationValue("7d");
  if (choice === "3") return parseExpirationValue("30d");
  if (choice === "4") return parseExpirationValue("90d");
  if (choice === "5") {
    const customValue = await prompter.ask("Enter duration (30d) or ISO date");
    return parseExpirationValue(customValue);
  }

  return parseExpirationValue(choice);
}

function parseArgs(argv = []) {
  const result = {
    envPath: ".env",
    expires: "",
    help: false,
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
    } else if (arg === "--expires") {
      result.expires = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--expires=")) {
      result.expires = arg.slice("--expires=".length);
    }
  }

  return result;
}

function showHelp(commandName = "node src/admin-key.js") {
  process.stdout.write(formatHelp(`
urthreads Admin Key Generator

USAGE:
  ${commandName}
  ${commandName} --expires <never|30d|ISO-date>
  ${commandName} --env ./path/to/.env --expires 90d

DESCRIPTION:
  Generates a secure admin API key, writes it to ADMIN_API_KEY in .env, and
  writes ADMIN_API_KEY_EXPIRES_AT with an ISO timestamp or an empty value for
  keys that never expire. The generated key is copied to your clipboard when
  clipboard tooling is available; it is not printed to terminal output.

`));
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/admin-key.js";
  const output = options.output || process.stdout;
  const args = parseArgs(argv);

  if (args.help) {
    showHelp(commandName);
    return;
  }

  const prompter = options.prompter || createPrompter();

  try {
    const expiration = args.expires
      ? parseExpirationValue(args.expires)
      : await selectExpiration(prompter, output);
    const adminKey = (options.generateAdminApiKey || generateAdminApiKey)();
    const envPath = path.resolve(process.cwd(), args.envPath);
    const copyResult = (options.copyToClipboard || copyToClipboard)(adminKey);

    writeEnvFile(envPath, {
      [ADMIN_KEY_NAME]: adminKey,
      [ADMIN_KEY_EXPIRES_AT_NAME]: expiration.expiresAt,
    });

    output.write(`\nUpdated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    output.write(`${ADMIN_KEY_EXPIRES_AT_NAME}=${expiration.label}\n\n`);
    if (copyResult.copied) {
      output.write(`Copied ${ADMIN_KEY_NAME} to your clipboard.\n\n`);
    } else {
      output.write(`Generated ${ADMIN_KEY_NAME} and wrote it to .env.\n`);
      output.write("Clipboard copy was unavailable in this shell, so the key was not printed.\n\n");
    }
    output.write("Next steps:\n");
    output.write("  1. Store ADMIN_API_KEY as a Worker secret: wrangler secret put ADMIN_API_KEY\n");
    output.write("  2. Deploy/update ADMIN_API_KEY_EXPIRES_AT with your Worker environment if it expires.\n\n");
  } finally {
    if (!options.prompter) {
      prompter.close();
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/admin-key.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  ADMIN_KEY_EXPIRES_AT_NAME,
  ADMIN_KEY_NAME,
  copyToClipboard,
  generateAdminApiKey,
  main,
  parseArgs,
  parseExpirationValue,
  showHelp,
  upsertEnvVars,
  writeEnvFile,
};
