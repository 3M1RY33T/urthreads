#!/usr/bin/env node

/**
 * Manage local .env values that support dashboard setup and deployment.
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { copyToClipboard, writeEnvFile } = require("./admin-key");
const { writeExampleWorkerConfig } = require("./example-config");
const { formatHelp } = require("./help-format");
const {
  getWranglerValue,
  updateWranglerToml,
} = require("./wrangler-config");

const DEFAULT_ENV_PATH = ".env";
const DEFAULT_WRANGLER_PATH = "wrangler.toml";
const DEFAULT_ORIGIN_KEY = "ALLOWED_ORIGINS";
const ORIGIN_TARGETS = {
  default: "ALLOWED_ORIGINS",
  local: "ALLOWED_ORIGINS",
  staging: "ALLOWED_ORIGINS_STAGING",
  production: "ALLOWED_ORIGINS_PROD",
  prod: "ALLOWED_ORIGINS_PROD",
};
const ORIGIN_KEY_TARGETS = {
  ALLOWED_ORIGINS: "default",
  ALLOWED_ORIGINS_STAGING: "staging",
  ALLOWED_ORIGINS_PROD: "production",
};
const SYNCED_ENV_KEYS = new Set([
  "ALLOWED_ORIGINS",
  "ALLOWED_ORIGINS_STAGING",
  "ALLOWED_ORIGINS_PROD",
  "WORKER_NAME",
  "WORKER_URL",
  "D1_DATABASE_NAME",
  "D1_DATABASE_ID",
  "CLOUDFLARE_ACCOUNT_ID",
  "ADMIN_API_KEY_EXPIRES_AT",
  "ADMIN_SESSION_TTL_SECONDS",
  "MAX_COMMENTS_PER_POST",
]);

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

function parseOriginInputs(values) {
  return values.flatMap(parseOriginList);
}

function normalizeOriginList(values) {
  return Array.from(new Set(parseOriginInputs(values).map(normalizeOrigin))).join(",");
}

function mergeAllowedOrigins(existingValue, origins) {
  const existingOrigins = parseOriginList(existingValue)
    .filter((origin) => origin !== "*")
    .map(normalizeOrigin);
  const nextOrigins = parseOriginInputs(origins).map(normalizeOrigin);
  return Array.from(new Set([...existingOrigins, ...nextOrigins])).join(",");
}

function resolveOriginKey(target) {
  const normalized = String(target || "default").trim().toLowerCase();
  if (ORIGIN_TARGETS[normalized]) return ORIGIN_TARGETS[normalized];
  return normalizeEnvKey(target);
}

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function resolveOriginKeys(args) {
  const targets = args.originTargets.length > 0 ? args.originTargets : [args.target];
  return uniqueValues(targets.map(resolveOriginKey));
}

function resolveOriginTargetFromKey(key) {
  return ORIGIN_KEY_TARGETS[normalizeEnvKey(key)] || "default";
}

function readWranglerContentIfExists(wranglerPath) {
  if (!fs.existsSync(wranglerPath)) return "";
  return fs.readFileSync(wranglerPath, "utf8");
}

function getWranglerSyncUpdates(key, value) {
  const normalizedKey = normalizeEnvKey(key);
  if (normalizedKey === "ALLOWED_ORIGINS_STAGING") {
    return [{ key: "ALLOWED_ORIGINS", value, envName: "staging" }];
  }
  if (normalizedKey === "ALLOWED_ORIGINS_PROD") {
    return [{ key: "ALLOWED_ORIGINS", value, envName: "production" }];
  }
  if (normalizedKey === "D1_DATABASE_ID") {
    return [{ key: "database_id", value, envName: "default" }];
  }
  if (normalizedKey === "D1_DATABASE_NAME") {
    return [
      { key: "database_name", value, envName: "default" },
      { key: "D1_DATABASE_NAME", value, envName: "default" },
    ];
  }
  if (normalizedKey === "CLOUDFLARE_ACCOUNT_ID") {
    return [{ key: "account_id", value, envName: "default" }];
  }
  if (normalizedKey === "WORKER_NAME") {
    return [
      { key: "name", value, envName: "default" },
      { key: "WORKER_NAME", value, envName: "default" },
    ];
  }
  if (SYNCED_ENV_KEYS.has(normalizedKey)) {
    return [{ key: normalizedKey, value, envName: "default" }];
  }
  return [];
}

function syncWranglerFromEnvValue(wranglerPath, key, value) {
  if (!fs.existsSync(wranglerPath)) return false;
  let content = readWranglerContentIfExists(wranglerPath);
  const updates = getWranglerSyncUpdates(key, value);
  if (updates.length === 0) return false;

  for (const update of updates) {
    content = updateWranglerToml(content, update.key, update.value, update.envName);
  }
  fs.writeFileSync(wranglerPath, content, { encoding: "utf8" });
  return true;
}

function getExistingOriginValues(envValues, wranglerContent, key) {
  const target = resolveOriginTargetFromKey(key);
  return [
    envValues[key] || "",
    wranglerContent ? getWranglerValue(wranglerContent, "ALLOWED_ORIGINS", target) : "",
  ];
}

function parseArgs(argv = []) {
  const result = {
    command: argv[0] || "",
    envPath: DEFAULT_ENV_PATH,
    wranglerPath: DEFAULT_WRANGLER_PATH,
    target: "default",
    originTargets: [],
    key: "",
    value: "",
    values: [],
    help: false,
    syncWrangler: true,
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
    } else if (arg === "--toml" || arg === "--wrangler-path") {
      result.wranglerPath = argv[index + 1] || result.wranglerPath;
      index += 1;
    } else if (arg.startsWith("--toml=")) {
      result.wranglerPath = arg.slice("--toml=".length);
    } else if (arg.startsWith("--wrangler-path=")) {
      result.wranglerPath = arg.slice("--wrangler-path=".length);
    } else if (arg === "--no-wrangler" || arg === "--no-sync") {
      result.syncWrangler = false;
    } else if (arg === "--default" || arg === "--local") {
      result.originTargets.push("default");
    } else if (arg === "--staging") {
      result.originTargets.push("staging");
    } else if (arg === "--production" || arg === "--prod") {
      result.originTargets.push("production");
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

function resolveCopyKey(command, key = "") {
  const shortcutKeys = {
    "copy-admin-key": "ADMIN_API_KEY",
    "copy-dashboard-key": "ADMIN_API_KEY",
    "copy-worker-url": "WORKER_URL",
    "copy-dashboard-url": "WORKER_URL",
    "copy-d1-id": "D1_DATABASE_ID",
    "copy-database-id": "D1_DATABASE_ID",
    "copy-account-id": "CLOUDFLARE_ACCOUNT_ID",
  };
  return shortcutKeys[command] || key;
}

function copyEnvValue(envPath, key, options = {}) {
  const normalizedKey = normalizeEnvKey(key);
  const values = readEnvValues(envPath);
  const value = values[normalizedKey] ?? "";
  if (!value) {
    throw new Error(`${normalizedKey} is not set in ${path.basename(envPath)}.`);
  }

  const copier = options.copyToClipboard || copyToClipboard;
  return {
    key: normalizedKey,
    ...copier(value),
  };
}

function showHelp(commandName = "node src/env-config.js") {
  process.stdout.write(formatHelp(`
urthreads Environment Config

USAGE:
  ${commandName} add-origin <origin...> [--target default|staging|prod] [--staging] [--production] [--toml wrangler.toml]
  ${commandName} set <KEY> <VALUE> [--toml wrangler.toml]
  ${commandName} get <KEY> [--show-sensitive]
  ${commandName} copy <KEY>
  ${commandName} copy-admin-key
  ${commandName} copy-worker-url
  ${commandName} copy-d1-id
  ${commandName} list [--show-sensitive]
  ${commandName} open [--viewer <command>]

DESCRIPTION:
  Updates local .env values without exposing secrets in terminal output.
  add-origin removes wildcard CORS values and appends exact origins safely.
  Shared Worker values are also written to wrangler.toml when it exists.
  copy sends values to your clipboard without printing them.

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
  const wranglerPath = path.resolve(process.cwd(), args.wranglerPath);

  if (command === "add-origin" || command === "add-origins" || command === "origin" || command === "origins" || command === "add") {
    const origins = args.values;
    if (origins.length === 0) {
      throw new Error("Provide at least one exact origin to add.");
    }

    const keys = resolveOriginKeys(args);
    const existingValues = readEnvValues(envPath);
    const wranglerContent = args.syncWrangler ? readWranglerContentIfExists(wranglerPath) : "";
    const updates = {};
    for (const key of keys) {
      updates[key] = mergeAllowedOrigins(getExistingOriginValues(existingValues, wranglerContent, key).join(","), origins);
    }

    writeEnvFile(envPath, updates);
    output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);

    let syncedWrangler = false;
    if (args.syncWrangler) {
      for (const [key, nextValue] of Object.entries(updates)) {
        syncedWrangler = syncWranglerFromEnvValue(wranglerPath, key, nextValue) || syncedWrangler;
      }
      if (syncedWrangler) {
        output.write(`Updated ${path.relative(process.cwd(), wranglerPath) || "wrangler.toml"}\n`);
      }
    }

    for (const [key, nextValue] of Object.entries(updates)) {
      output.write(`${key}=${nextValue}\n`);
    }
    return;
  }

  if (command === "set") {
    const key = normalizeEnvKey(args.key);
    if (!args.value) {
      throw new Error("Provide a value to set.");
    }

    const value = ORIGIN_KEY_TARGETS[key] ? normalizeOriginList(args.values.slice(1)) : args.value;
    if (ORIGIN_KEY_TARGETS[key] && !value) {
      throw new Error("Provide at least one exact origin to set.");
    }

    writeEnvFile(envPath, { [key]: value });
    output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    if (args.syncWrangler && syncWranglerFromEnvValue(wranglerPath, key, value)) {
      output.write(`Updated ${path.relative(process.cwd(), wranglerPath) || "wrangler.toml"}\n`);
    }
    output.write(`${key}=${isSensitiveEnvKey(key) ? "(hidden)" : value}\n`);
    if (key === "WORKER_URL") {
      const exampleConfigPath = writeExampleWorkerConfig(value, {
        generatedBy: "urthreads env set WORKER_URL",
      });
      output.write(`Updated ${path.relative(process.cwd(), exampleConfigPath)}\n`);
    }
    return;
  }

  if (command === "get") {
    const key = normalizeEnvKey(args.key);
    const values = readEnvValues(envPath);
    const value = values[key] ?? "";
    output.write(`${key}=${isSensitiveEnvKey(key) && !args.showSensitive ? "(hidden)" : value}\n`);
    return;
  }

  if (command === "copy" || command === "cp" || command.startsWith("copy-")) {
    const key = resolveCopyKey(command, args.key);
    if (!key) {
      throw new Error("Provide an environment key to copy.");
    }
    const result = copyEnvValue(envPath, key, {
      copyToClipboard: options.copyToClipboard,
    });
    if (result.copied) {
      output.write(`Copied ${result.key} to your clipboard.\n`);
    } else {
      output.write(`Clipboard copy was unavailable, so ${result.key} was not printed.\n`);
    }
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
  copyEnvValue,
  main,
  mergeAllowedOrigins,
  normalizeOrigin,
  parseArgs,
  parseEnvContent,
  readEnvValues,
  resolveOriginKey,
  showHelp,
};
