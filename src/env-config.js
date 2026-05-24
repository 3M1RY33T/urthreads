#!/usr/bin/env node

/**
 * Manage local .env values that support dashboard setup and deployment.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeEnvFile } = require("./admin-key");
const { formatHelp } = require("./help-format");

const DEFAULT_ENV_PATH = ".env";
const DEFAULT_ORIGIN_KEY = "ALLOWED_ORIGINS";
const ORIGIN_TARGETS = {
  default: "ALLOWED_ORIGINS",
  local: "ALLOWED_ORIGINS",
  staging: "ALLOWED_ORIGINS_STAGING",
  production: "ALLOWED_ORIGINS_PROD",
  prod: "ALLOWED_ORIGINS_PROD",
};

function getEnvKey(line) {
  const match = String(line).match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
  return match ? match[1] : "";
}

function parseEnvContent(content) {
  const values = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const key = getEnvKey(line);
    if (!key) continue;
    values[key] = line.slice(line.indexOf("=") + 1);
  }
  return values;
}

function readEnvValues(envPath) {
  if (!fs.existsSync(envPath)) return {};
  return parseEnvContent(fs.readFileSync(envPath, "utf8"));
}

function isSensitiveEnvKey(key) {
  return /(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(String(key || ""));
}

function normalizeEnvKey(key) {
  const normalized = String(key || "").trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) {
    throw new Error("Environment variable names must use letters, numbers, and underscores.");
  }
  return normalized;
}

function normalizeOrigin(value) {
  const text = String(value || "").trim().replace(/\/+$/, "");
  if (!text || text === "*") {
    throw new Error("Allowed origins must be exact http or https origins, not '*'.");
  }

  let url;
  try {
    url = new URL(text);
  } catch (error) {
    throw new Error(`Invalid origin: ${value}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Origin must use http or https: ${value}`);
  }

  if (url.pathname !== "/" || url.search || url.hash) {
    return url.origin;
  }

  return url.origin;
}

function parseOriginList(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function mergeAllowedOrigins(existingValue, origins) {
  const existingOrigins = parseOriginList(existingValue)
    .filter((origin) => origin !== "*")
    .map(normalizeOrigin);
  const nextOrigins = origins.map(normalizeOrigin);
  return Array.from(new Set([...existingOrigins, ...nextOrigins])).join(",");
}

function resolveOriginKey(target) {
  const normalized = String(target || "default").trim().toLowerCase();
  if (ORIGIN_TARGETS[normalized]) return ORIGIN_TARGETS[normalized];
  return normalizeEnvKey(target);
}

function parseArgs(argv = []) {
  const result = {
    command: argv[0] || "",
    envPath: DEFAULT_ENV_PATH,
    target: "default",
    key: "",
    value: "",
    values: [],
    help: false,
    showSensitive: false,
    viewer: "",
  };

  if (result.command === "--help" || result.command === "-h" || result.command === "help") {
    result.help = true;
  }

  const positional = [];
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h" || arg === "help") {
      result.help = true;
    } else if (arg === "--env") {
      result.envPath = argv[index + 1] || result.envPath;
      index += 1;
    } else if (arg.startsWith("--env=")) {
      result.envPath = arg.slice("--env=".length);
    } else if (arg === "--target") {
      result.target = argv[index + 1] || result.target;
      index += 1;
    } else if (arg.startsWith("--target=")) {
      result.target = arg.slice("--target=".length);
    } else if (arg === "--key") {
      result.key = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--key=")) {
      result.key = arg.slice("--key=".length);
    } else if (arg === "--viewer" || arg === "--editor") {
      result.viewer = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--viewer=")) {
      result.viewer = arg.slice("--viewer=".length);
    } else if (arg === "--show-sensitive") {
      result.showSensitive = true;
    } else {
      positional.push(arg);
    }
  }

  result.values = positional;
  result.key = result.key || positional[0] || "";
  result.value = positional.slice(1).join(" ");
  return result;
}

function getOpenCommand(envPath, viewer = "", platform = process.platform) {
  if (viewer) return { command: viewer, args: [envPath] };
  if (platform === "darwin") return { command: "open", args: [envPath] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", envPath] };
  return { command: "xdg-open", args: [envPath] };
}

function openEnvFile(envPath, options = {}) {
  if (!fs.existsSync(envPath)) {
    throw new Error(`${path.basename(envPath)} does not exist yet. Run urthreads setup-env first.`);
  }

  const opener = options.opener || spawnSync;
  const openCommand = getOpenCommand(envPath, options.viewer, options.platform);
  const result = opener(openCommand.command, openCommand.args, {
    detached: true,
    stdio: "ignore",
  });

  if (result?.error) throw result.error;
  if (typeof result?.status === "number" && result.status !== 0) {
    throw new Error(`Unable to open ${envPath} with ${openCommand.command}.`);
  }

  return openCommand;
}

function showHelp(commandName = "node src/env-config.js") {
  process.stdout.write(formatHelp(`
urthreads Environment Config

USAGE:
  ${commandName} add-origin <origin...> [--target default|staging|prod]
  ${commandName} set <KEY> <VALUE>
  ${commandName} get <KEY> [--show-sensitive]
  ${commandName} list [--show-sensitive]
  ${commandName} open [--viewer <command>]

DESCRIPTION:
  Updates local .env values without exposing secrets in terminal output.
  add-origin removes wildcard CORS values and appends exact origins safely.

`));
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/env-config.js";
  const output = options.output || process.stdout;
  const args = parseArgs(argv);
  const command = args.command;

  if (!command || args.help || command === "help") {
    showHelp(commandName);
    return;
  }

  const envPath = path.resolve(process.cwd(), args.envPath);

  if (command === "add-origin" || command === "add-origins" || command === "origin" || command === "origins" || command === "add") {
    const origins = args.values;
    if (origins.length === 0) {
      throw new Error("Provide at least one exact origin to add.");
    }

    const key = resolveOriginKey(args.target);
    const existingValues = readEnvValues(envPath);
    const nextValue = mergeAllowedOrigins(existingValues[key], origins);
    writeEnvFile(envPath, { [key]: nextValue });
    output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    output.write(`${key}=${nextValue}\n`);
    return;
  }

  if (command === "set") {
    const key = normalizeEnvKey(args.key);
    if (!args.value) {
      throw new Error("Provide a value to set.");
    }

    writeEnvFile(envPath, { [key]: args.value });
    output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    output.write(`${key}=${isSensitiveEnvKey(key) ? "(hidden)" : args.value}\n`);
    return;
  }

  if (command === "get") {
    const key = normalizeEnvKey(args.key);
    const values = readEnvValues(envPath);
    const value = values[key] ?? "";
    output.write(`${key}=${isSensitiveEnvKey(key) && !args.showSensitive ? "(hidden)" : value}\n`);
    return;
  }

  if (command === "list") {
    const values = readEnvValues(envPath);
    for (const key of Object.keys(values).sort()) {
      const value = isSensitiveEnvKey(key) && !args.showSensitive ? "(hidden)" : values[key];
      output.write(`${key}=${value}\n`);
    }
    return;
  }

  if (command === "open" || command === "view") {
    const opened = openEnvFile(envPath, { viewer: args.viewer, opener: options.opener });
    output.write(`Opened ${path.relative(process.cwd(), envPath) || ".env"} with ${opened.command}.\n`);
    return;
  }

  throw new Error(`Unknown env command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/env-config.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULT_ORIGIN_KEY,
  getOpenCommand,
  main,
  mergeAllowedOrigins,
  normalizeOrigin,
  parseArgs,
  parseEnvContent,
  readEnvValues,
  resolveOriginKey,
  showHelp,
};
