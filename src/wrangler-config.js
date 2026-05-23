#!/usr/bin/env node

/**
 * Create and manage wrangler.toml for urthreads deployments.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

const DEFAULT_WRANGLER_PATH = "wrangler.toml";
const DEFAULTS = {
  workerName: "urthreads-worker",
  main: "src/worker.js",
  compatibilityDate: "2026-05-20",
  accountId: "",
  workersDev: "true",
  databaseName: "your-threads",
  databaseId: "00000000-0000-0000-0000-000000000000",
  allowedOrigins: "https://example.com",
  allowedOriginsStaging: "https://staging.example.com,http://localhost:3000",
  allowedOriginsProd: "https://example.com,https://www.example.com",
  adminSessionTtlSeconds: "3600",
  maxCommentsPerPost: "100",
};

const TOP_LEVEL_KEYS = new Set(["name", "main", "compatibility_date", "account_id", "workers_dev"]);
const DATABASE_KEYS = new Set(["database_name", "database_id", "binding"]);
const DEFAULT_BINDING = "DB";

function tomlString(value) {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}"`;
}

function tomlValue(key, value) {
  if (key === "workers_dev") {
    return String(value).trim().toLowerCase() === "false" ? "false" : "true";
  }
  return tomlString(value);
}

function normalizeBooleanText(value) {
  return String(value).trim().toLowerCase() === "false" ? "false" : "true";
}

function buildWranglerTomlContent(config = {}) {
  const workerName = config.workerName || DEFAULTS.workerName;
  const databaseName = config.databaseName || DEFAULTS.databaseName;
  const databaseId = config.databaseId || DEFAULTS.databaseId;
  const productionWorkerName = config.productionWorkerName || `${workerName}-prod`;
  const stagingWorkerName = config.stagingWorkerName || `${workerName}-staging`;
  const productionDatabaseName = config.productionDatabaseName || `${databaseName}-prod`;
  const stagingDatabaseName = config.stagingDatabaseName || `${databaseName}-staging`;
  const productionDatabaseId = config.productionDatabaseId || DEFAULTS.databaseId;
  const stagingDatabaseId = config.stagingDatabaseId || DEFAULTS.databaseId;
  const allowedOrigins = config.allowedOrigins || DEFAULTS.allowedOrigins;
  const allowedOriginsProd = config.allowedOriginsProd || DEFAULTS.allowedOriginsProd;
  const allowedOriginsStaging = config.allowedOriginsStaging || DEFAULTS.allowedOriginsStaging;
  const adminSessionTtlSeconds = config.adminSessionTtlSeconds || DEFAULTS.adminSessionTtlSeconds;
  const maxCommentsPerPost = config.maxCommentsPerPost || DEFAULTS.maxCommentsPerPost;

  return [
    `name = ${tomlString(workerName)}`,
    `main = ${tomlString(config.main || DEFAULTS.main)}`,
    `compatibility_date = ${tomlString(config.compatibilityDate || DEFAULTS.compatibilityDate)}`,
    `account_id = ${tomlString(config.accountId || DEFAULTS.accountId)}`,
    `workers_dev = ${normalizeBooleanText(config.workersDev || DEFAULTS.workersDev)}`,
    "",
    "[env.production]",
    `name = ${tomlString(productionWorkerName)}`,
    "",
    "[env.staging]",
    `name = ${tomlString(stagingWorkerName)}`,
    "",
    "[[d1_databases]]",
    `binding = ${tomlString(DEFAULT_BINDING)}`,
    `database_name = ${tomlString(databaseName)}`,
    `database_id = ${tomlString(databaseId)}`,
    "",
    "[[env.production.d1_databases]]",
    `binding = ${tomlString(DEFAULT_BINDING)}`,
    `database_name = ${tomlString(productionDatabaseName)}`,
    `database_id = ${tomlString(productionDatabaseId)}`,
    "",
    "[[env.staging.d1_databases]]",
    `binding = ${tomlString(DEFAULT_BINDING)}`,
    `database_name = ${tomlString(stagingDatabaseName)}`,
    `database_id = ${tomlString(stagingDatabaseId)}`,
    "",
    "[vars]",
    `ALLOWED_ORIGINS = ${tomlString(allowedOrigins)}`,
    `WORKER_NAME = ${tomlString(workerName)}`,
    `D1_DATABASE_NAME = ${tomlString(databaseName)}`,
    `ADMIN_API_KEY_EXPIRES_AT = ${tomlString(config.adminApiKeyExpiresAt || "")}`,
    `ADMIN_SESSION_TTL_SECONDS = ${tomlString(adminSessionTtlSeconds)}`,
    `MAX_COMMENTS_PER_POST = ${tomlString(maxCommentsPerPost)}`,
    "",
    "[env.production.vars]",
    `ALLOWED_ORIGINS = ${tomlString(allowedOriginsProd)}`,
    `WORKER_NAME = ${tomlString(productionWorkerName)}`,
    `D1_DATABASE_NAME = ${tomlString(productionDatabaseName)}`,
    `ADMIN_API_KEY_EXPIRES_AT = ${tomlString(config.adminApiKeyExpiresAt || "")}`,
    `ADMIN_SESSION_TTL_SECONDS = ${tomlString(adminSessionTtlSeconds)}`,
    `MAX_COMMENTS_PER_POST = ${tomlString(maxCommentsPerPost)}`,
    "",
    "[env.staging.vars]",
    `ALLOWED_ORIGINS = ${tomlString(allowedOriginsStaging)}`,
    `WORKER_NAME = ${tomlString(stagingWorkerName)}`,
    `D1_DATABASE_NAME = ${tomlString(stagingDatabaseName)}`,
    `ADMIN_API_KEY_EXPIRES_AT = ${tomlString(config.adminApiKeyExpiresAt || "")}`,
    `ADMIN_SESSION_TTL_SECONDS = ${tomlString(adminSessionTtlSeconds)}`,
    `MAX_COMMENTS_PER_POST = ${tomlString(maxCommentsPerPost)}`,
    "",
  ].join("\n");
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

async function collectWranglerConfig(prompter, output = process.stdout, defaults = {}) {
  output.write("\nWrangler configuration setup\n");
  output.write("This will create a wrangler.toml file for your Worker deployment.\n\n");

  const workerName = await prompter.ask("Worker name", defaults.workerName || DEFAULTS.workerName);
  const main = await prompter.ask("Worker entrypoint", defaults.main || DEFAULTS.main);
  const compatibilityDate = await prompter.ask(
    "Compatibility date",
    defaults.compatibilityDate || DEFAULTS.compatibilityDate
  );
  const accountId = await prompter.ask("Cloudflare account ID", defaults.accountId || DEFAULTS.accountId);
  const workersDev = await prompter.ask("Use workers.dev route? true/false", defaults.workersDev || DEFAULTS.workersDev);

  output.write("\nD1 database\n");
  const databaseName = await prompter.ask("D1 database name", defaults.databaseName || DEFAULTS.databaseName);
  const databaseId = await prompter.ask("D1 database ID", defaults.databaseId || DEFAULTS.databaseId);

  output.write("\nRuntime variables\n");
  const allowedOrigins = await prompter.ask("Allowed origins", defaults.allowedOrigins || DEFAULTS.allowedOrigins);
  const adminSessionTtlSeconds = await prompter.ask(
    "Admin session TTL seconds",
    defaults.adminSessionTtlSeconds || DEFAULTS.adminSessionTtlSeconds
  );
  const maxCommentsPerPost = await prompter.ask(
    "Maximum comments returned per post",
    defaults.maxCommentsPerPost || DEFAULTS.maxCommentsPerPost
  );

  output.write("\nProduction environment\n");
  const productionWorkerName = await prompter.ask("Production Worker name", defaults.productionWorkerName || `${workerName}-prod`);
  const productionDatabaseName = await prompter.ask("Production D1 database name", defaults.productionDatabaseName || `${databaseName}-prod`);
  const productionDatabaseId = await prompter.ask("Production D1 database ID", defaults.productionDatabaseId || DEFAULTS.databaseId);
  const allowedOriginsProd = await prompter.ask("Production allowed origins", defaults.allowedOriginsProd || DEFAULTS.allowedOriginsProd);

  output.write("\nStaging environment\n");
  const stagingWorkerName = await prompter.ask("Staging Worker name", defaults.stagingWorkerName || `${workerName}-staging`);
  const stagingDatabaseName = await prompter.ask("Staging D1 database name", defaults.stagingDatabaseName || `${databaseName}-staging`);
  const stagingDatabaseId = await prompter.ask("Staging D1 database ID", defaults.stagingDatabaseId || DEFAULTS.databaseId);
  const allowedOriginsStaging = await prompter.ask("Staging allowed origins", defaults.allowedOriginsStaging || DEFAULTS.allowedOriginsStaging);

  return {
    workerName,
    main,
    compatibilityDate,
    accountId,
    workersDev,
    databaseName,
    databaseId,
    allowedOrigins,
    adminSessionTtlSeconds,
    maxCommentsPerPost,
    productionWorkerName,
    productionDatabaseName,
    productionDatabaseId,
    allowedOriginsProd,
    stagingWorkerName,
    stagingDatabaseName,
    stagingDatabaseId,
    allowedOriginsStaging,
  };
}

function tableHeaderForKey(key, envName = "default") {
  const normalizedKey = normalizeWranglerKey(key);
  const normalizedEnv = normalizeEnvName(envName);

  if (TOP_LEVEL_KEYS.has(normalizedKey)) {
    return normalizedEnv === "default" ? "" : `env.${normalizedEnv}`;
  }

  if (DATABASE_KEYS.has(normalizedKey)) {
    return normalizedEnv === "default" ? "d1_databases" : `env.${normalizedEnv}.d1_databases`;
  }

  return normalizedEnv === "default" ? "vars" : `env.${normalizedEnv}.vars`;
}

function normalizeEnvName(value) {
  const normalized = String(value || "default").trim().toLowerCase();
  if (!normalized || normalized === "local") return "default";
  if (normalized === "prod") return "production";
  return normalized;
}

function normalizeWranglerKey(value) {
  const text = String(value || "").trim();
  const lower = text.toLowerCase().replace(/-/g, "_");
  if (lower === "compatibility") return "compatibility_date";
  if (lower === "account") return "account_id";
  if (lower === "workers") return "workers_dev";
  if (lower === "d1_database_name") return "D1_DATABASE_NAME";
  if (lower === "d1_database_id") return "database_id";
  if (/^[A-Z_][A-Z0-9_]*$/.test(text)) return text;
  return lower;
}

function headerName(line) {
  const match = String(line).trim().match(/^\[\[?([^\]]+)\]\]?$/);
  return match ? match[1] : "";
}

function findSectionRange(lines, sectionName) {
  if (!sectionName) {
    const end = lines.findIndex((line) => headerName(line));
    return { start: 0, end: end === -1 ? lines.length : end, exists: true };
  }

  const headerIndex = lines.findIndex((line) => headerName(line) === sectionName);
  if (headerIndex === -1) {
    return { start: lines.length, end: lines.length, exists: false };
  }

  let end = lines.length;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (headerName(lines[index])) {
      end = index;
      break;
    }
  }

  return { start: headerIndex + 1, end, exists: true };
}

function sectionHeaderLine(sectionName) {
  if (!sectionName) return "";
  return sectionName.includes("d1_databases")
    ? `[[${sectionName}]]`
    : `[${sectionName}]`;
}

function ensureSection(lines, sectionName) {
  const range = findSectionRange(lines, sectionName);
  if (range.exists) return range;

  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push(sectionHeaderLine(sectionName));

  if (sectionName.includes("d1_databases")) {
    lines.push(`binding = ${tomlString(DEFAULT_BINDING)}`);
  }

  return { start: lines.length, end: lines.length, exists: true };
}

function setLineInSection(lines, sectionName, key, value) {
  const range = ensureSection(lines, sectionName);
  const normalizedKey = normalizeWranglerKey(key);
  const nextLine = `${normalizedKey} = ${tomlValue(normalizedKey, value)}`;
  const pattern = new RegExp(`^\\s*${normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);

  for (let index = range.start; index < range.end; index += 1) {
    if (pattern.test(lines[index])) {
      lines[index] = nextLine;
      return;
    }
  }

  lines.splice(range.end, 0, nextLine);
}

function updateWranglerToml(content, key, value, envName = "default") {
  const lines = String(content || "").split(/\r?\n/);
  if (lines.length === 1 && lines[0] === "") lines.pop();
  const normalizedKey = normalizeWranglerKey(key);
  const sectionName = tableHeaderForKey(normalizedKey, envName);
  setLineInSection(lines, sectionName, normalizedKey, value);
  return `${lines.join("\n").replace(/\n*$/g, "")}\n`;
}

function parseTomlScalar(value) {
  const text = String(value || "").trim();
  if (text === "true") return "true";
  if (text === "false") return "false";
  const quoted = text.match(/^"(.*)"(?:\s+#.*)?$/);
  if (quoted) {
    return quoted[1].replace(/\\"/g, "\"").replace(/\\\\/g, "\\");
  }
  return text.replace(/\s+#.*$/g, "");
}

function getWranglerValue(content, key, envName = "default") {
  const lines = String(content || "").split(/\r?\n/);
  const normalizedKey = normalizeWranglerKey(key);
  const sectionName = tableHeaderForKey(normalizedKey, envName);
  const range = findSectionRange(lines, sectionName);
  if (!range.exists) return "";
  const pattern = new RegExp(`^\\s*${normalizedKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=\\s*(.+)$`);

  for (let index = range.start; index < range.end; index += 1) {
    const match = lines[index].match(pattern);
    if (match) return parseTomlScalar(match[1]);
  }

  return "";
}

function listWranglerValues(content) {
  const lines = String(content || "").split(/\r?\n/);
  let currentSection = "default";
  const values = [];

  for (const line of lines) {
    const foundHeader = headerName(line);
    if (foundHeader) {
      currentSection = foundHeader;
      continue;
    }

    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!match) continue;
    values.push({
      section: currentSection,
      key: match[1],
      value: parseTomlScalar(match[2]),
    });
  }

  return values;
}

function writeWranglerTomlFile(filePath, content) {
  fs.writeFileSync(filePath, content, { encoding: "utf8" });
}

function readWranglerToml(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${path.basename(filePath)} does not exist yet. Run urthreads wrangler-init first.`);
  }
  return fs.readFileSync(filePath, "utf8");
}

function parseArgs(argv = []) {
  const result = {
    command: argv[0] || "",
    filePath: DEFAULT_WRANGLER_PATH,
    envName: "default",
    key: "",
    value: "",
    values: [],
    help: false,
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
    } else if (arg === "--file" || arg === "--toml") {
      result.filePath = argv[index + 1] || result.filePath;
      index += 1;
    } else if (arg.startsWith("--file=")) {
      result.filePath = arg.slice("--file=".length);
    } else if (arg === "--env") {
      result.envName = argv[index + 1] || result.envName;
      index += 1;
    } else if (arg.startsWith("--env=")) {
      result.envName = arg.slice("--env=".length);
    } else if (arg === "--viewer" || arg === "--editor") {
      result.viewer = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--viewer=")) {
      result.viewer = arg.slice("--viewer=".length);
    } else {
      positional.push(arg);
    }
  }

  result.values = positional;
  result.key = positional[0] || "";
  result.value = positional.slice(1).join(" ");
  return result;
}

function getOpenCommand(filePath, viewer = "", platform = process.platform) {
  if (viewer) return { command: viewer, args: [filePath] };
  if (platform === "darwin") return { command: "open", args: [filePath] };
  if (platform === "win32") return { command: "cmd", args: ["/c", "start", "", filePath] };
  return { command: "xdg-open", args: [filePath] };
}

function openWranglerToml(filePath, options = {}) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`${path.basename(filePath)} does not exist yet. Run urthreads wrangler-init first.`);
  }

  const opener = options.opener || spawnSync;
  const openCommand = getOpenCommand(filePath, options.viewer, options.platform);
  const result = opener(openCommand.command, openCommand.args, {
    detached: true,
    stdio: "ignore",
  });
  if (result?.error) throw result.error;
  if (typeof result?.status === "number" && result.status !== 0) {
    throw new Error(`Unable to open ${filePath} with ${openCommand.command}.`);
  }
  return openCommand;
}

function showHelp(commandName = "node src/wrangler-config.js") {
  process.stdout.write(`
Cloudflare Likes & Comments Wrangler Config

USAGE:
  ${commandName} init
  ${commandName} set <KEY> <VALUE> [--env staging|production]
  ${commandName} get <KEY> [--env staging|production]
  ${commandName} list
  ${commandName} open [--viewer <command>]

KEYS:
  name, main, compatibility_date, account_id, workers_dev
  database_name, database_id
  ALLOWED_ORIGINS, WORKER_NAME, D1_DATABASE_NAME
  ADMIN_API_KEY_EXPIRES_AT, ADMIN_SESSION_TTL_SECONDS, MAX_COMMENTS_PER_POST

EXAMPLES:
  urthreads wrangler-init
  urthreads wrangler set account_id your-account-id
  urthreads wrangler set database_id your-d1-id
  urthreads wrangler set ALLOWED_ORIGINS https://example.com
  urthreads wrangler set database_id prod-d1-id --env production
  urthreads wrangler get ALLOWED_ORIGINS
  urthreads wrangler open

`);
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/wrangler-config.js";
  const output = options.output || process.stdout;
  const args = parseArgs(argv);
  const command = args.command || "init";
  const filePath = path.resolve(process.cwd(), args.filePath);

  if (args.help || command === "help") {
    showHelp(commandName);
    return;
  }

  if (command === "init" || command === "create") {
    const prompter = options.prompter || createPrompter();
    try {
      if (fs.existsSync(filePath)) {
        const shouldOverwrite = await prompter.confirm(
          `${path.basename(filePath)} already exists. Overwrite it?`,
          false
        );
        if (!shouldOverwrite) {
          output.write("Wrangler setup cancelled. Existing wrangler.toml was left unchanged.\n");
          return;
        }
      }

      const config = options.config || await collectWranglerConfig(prompter, output, options.defaults || {});
      writeWranglerTomlFile(filePath, buildWranglerTomlContent(config));
      output.write(`\nCreated ${path.relative(process.cwd(), filePath) || "wrangler.toml"}\n`);
      output.write("Next steps:\n");
      output.write("  1. Confirm account_id and D1 database_id values.\n");
      output.write("  2. Set ADMIN_API_KEY as a Worker secret.\n");
      output.write("  3. Deploy with wrangler deploy.\n\n");
    } finally {
      if (!options.prompter) prompter.close();
    }
    return;
  }

  if (command === "set") {
    if (!args.key || !args.value) {
      throw new Error("Provide a key and value to set.");
    }
    const content = readWranglerToml(filePath);
    const nextContent = updateWranglerToml(content, args.key, args.value, args.envName);
    writeWranglerTomlFile(filePath, nextContent);
    output.write(`Updated ${path.relative(process.cwd(), filePath) || "wrangler.toml"}\n`);
    output.write(`${normalizeEnvName(args.envName)}.${normalizeWranglerKey(args.key)}=${args.value}\n`);
    return;
  }

  if (command === "get") {
    if (!args.key) throw new Error("Provide a key to read.");
    const value = getWranglerValue(readWranglerToml(filePath), args.key, args.envName);
    output.write(`${normalizeEnvName(args.envName)}.${normalizeWranglerKey(args.key)}=${value}\n`);
    return;
  }

  if (command === "list") {
    const values = listWranglerValues(readWranglerToml(filePath));
    for (const item of values) {
      output.write(`${item.section}.${item.key}=${item.value}\n`);
    }
    return;
  }

  if (command === "open" || command === "view") {
    const opened = openWranglerToml(filePath, { viewer: args.viewer, opener: options.opener });
    output.write(`Opened ${path.relative(process.cwd(), filePath) || "wrangler.toml"} with ${opened.command}.\n`);
    return;
  }

  throw new Error(`Unknown wrangler command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/wrangler-config.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS,
  buildWranglerTomlContent,
  collectWranglerConfig,
  getWranglerValue,
  listWranglerValues,
  main,
  normalizeEnvName,
  normalizeWranglerKey,
  openWranglerToml,
  parseArgs,
  updateWranglerToml,
  writeWranglerTomlFile,
};
