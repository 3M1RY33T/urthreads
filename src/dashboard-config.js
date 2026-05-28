#!/usr/bin/env node

/**
 * Install and refresh the static dashboard in a user's site output.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { writeEnvFile } = require("./admin-key");
const { formatHelp } = require("./help-format");
const { parseEnvContent, readEnvValues } = require("./env-config");

const DEFAULT_ENV_PATH = ".env";
const DASHBOARD_LOCAL_PATH_KEY = "DASHBOARD_LOCAL_PATH";
const DASHBOARD_ENDPOINT_KEY = "DASHBOARD_ENDPOINT";
const DEFAULT_DASHBOARD_LOCAL_PATH = "public";
const DEFAULT_DASHBOARD_ENDPOINT = "urthreads";

function createPrompter(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });

  function ask(question, defaultValue = "") {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    return new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, (answer) => {
        const value = String(answer || "").trim();
        resolve(value || defaultValue);
      });
    });
  }

  async function confirm(question, defaultValue = true) {
    const label = defaultValue ? "Y/n" : "y/N";
    const answer = String(await ask(`${question} [${label}]`)).trim().toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  }

  return {
    ask,
    confirm,
    close: () => rl.close(),
  };
}

function normalizeDashboardEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  if (!endpoint) {
    throw new Error("Dashboard endpoint is required.");
  }
  if (endpoint.includes("..") || endpoint.includes("\\") || /^https?:\/\//i.test(endpoint)) {
    throw new Error("Dashboard endpoint must be a local path segment such as 'urthreads'.");
  }
  return endpoint;
}

function resolveDashboardRoot(localPath, cwd = process.cwd()) {
  const value = String(localPath || "").trim();
  if (!value) {
    throw new Error("Dashboard local path is required.");
  }
  return path.resolve(cwd, value);
}

function copyFile(sourcePath, destinationPath) {
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.copyFileSync(sourcePath, destinationPath);
}

function copyDirectory(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }
  fs.mkdirSync(destinationDir, { recursive: true });

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, destinationPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, destinationPath);
    }
  }
}

function buildDashboard(options = {}) {
  const cwd = options.cwd || process.cwd();
  const packageRoot = path.resolve(__dirname, "..");
  const localRoot = resolveDashboardRoot(options.localPath, cwd);
  const endpoint = normalizeDashboardEndpoint(options.endpoint);
  const dashboardPath = path.join(localRoot, endpoint);

  copyDirectory(path.join(packageRoot, "web"), dashboardPath);
  copyDirectory(path.join(packageRoot, "assets"), path.join(localRoot, "assets"));

  return {
    dashboardPath,
    endpoint,
    localRoot,
  };
}

async function ensureDashboardRoot(localRoot, options = {}) {
  if (fs.existsSync(localRoot)) return false;

  const prompter = options.prompter || createPrompter();
  const shouldClosePrompter = !options.prompter;
  try {
    const question = `Dashboard path does not exist: ${localRoot}. Create it and build the dashboard there?`;
    const shouldCreate = typeof prompter.confirm === "function"
      ? await prompter.confirm(question, true)
      : /^y(?:es)?$/i.test(String(await prompter.ask(`${question} [Y/n]`, "yes")));
    if (!shouldCreate) {
      throw new Error("Dashboard build cancelled. Choose an existing path or allow urthreads to create it.");
    }
    fs.mkdirSync(localRoot, { recursive: true });
    return true;
  } finally {
    if (shouldClosePrompter) prompter.close();
  }
}

function parseArgs(argv = []) {
  const result = {
    command: argv[0] || "",
    envPath: DEFAULT_ENV_PATH,
    localPath: "",
    endpoint: "",
    help: false,
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
    } else if (arg === "--path" || arg === "--local-path") {
      result.localPath = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--path=")) {
      result.localPath = arg.slice("--path=".length);
    } else if (arg.startsWith("--local-path=")) {
      result.localPath = arg.slice("--local-path=".length);
    } else if (arg === "--endpoint" || arg === "--name") {
      result.endpoint = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--endpoint=")) {
      result.endpoint = arg.slice("--endpoint=".length);
    } else if (arg.startsWith("--name=")) {
      result.endpoint = arg.slice("--name=".length);
    } else {
      positional.push(arg);
    }
  }

  result.localPath = result.localPath || positional[0] || "";
  result.endpoint = result.endpoint || positional[1] || "";
  return result;
}

async function resolveConfiguredDashboard(args, envPath, options = {}) {
  const values = readEnvValues(envPath);
  const configured = {
    localPath: args.localPath || values[DASHBOARD_LOCAL_PATH_KEY] || "",
    endpoint: args.endpoint || values[DASHBOARD_ENDPOINT_KEY] || "",
  };
  if (configured.localPath && configured.endpoint) return configured;

  const prompter = options.prompter || createPrompter();
  let shouldClosePrompter = !options.prompter;
  try {
    if (!configured.localPath) {
      configured.localPath = await prompter.ask("Static site output path for the dashboard", DEFAULT_DASHBOARD_LOCAL_PATH);
    }
    if (!configured.endpoint) {
      configured.endpoint = await prompter.ask("Dashboard endpoint directory", DEFAULT_DASHBOARD_ENDPOINT);
    }
  } finally {
    if (shouldClosePrompter) prompter.close();
  }

  const localRoot = resolveDashboardRoot(configured.localPath);
  const endpoint = normalizeDashboardEndpoint(configured.endpoint);
  writeEnvFile(envPath, {
    [DASHBOARD_LOCAL_PATH_KEY]: localRoot,
    [DASHBOARD_ENDPOINT_KEY]: endpoint,
  });

  return {
    localPath: localRoot,
    endpoint,
    prompted: true,
  };
}

function showHelp(commandName = "node src/dashboard-config.js") {
  process.stdout.write(formatHelp(`
urthreads Dashboard Builder

USAGE:
  ${commandName} set <local-path> <endpoint>
  ${commandName} build
  ${commandName} update
  ${commandName} show

OPTIONS:
  --path <path>         Static site output root, such as public or dist
  --endpoint <name>     Dashboard route directory, such as urthreads
  --env <path>          .env file to store or read dashboard settings

DESCRIPTION:
  set stores DASHBOARD_LOCAL_PATH and DASHBOARD_ENDPOINT in .env, then builds
  the dashboard into <local-path>/<endpoint>. build and update reuse those saved
  values, or prompt for missing values and save them before building.

`));
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/dashboard-config.js";
  const output = options.output || process.stdout;
  const args = parseArgs(argv);
  const command = args.command;

  if (!command || args.help || command === "help") {
    showHelp(commandName);
    return;
  }

  const envPath = path.resolve(process.cwd(), args.envPath);

  if (command === "set" || command === "configure" || command === "config") {
    const localRoot = resolveDashboardRoot(args.localPath);
    const endpoint = normalizeDashboardEndpoint(args.endpoint);
    const createdRoot = await ensureDashboardRoot(localRoot, { prompter: options.prompter });
    writeEnvFile(envPath, {
      [DASHBOARD_LOCAL_PATH_KEY]: localRoot,
      [DASHBOARD_ENDPOINT_KEY]: endpoint,
    });
    const result = buildDashboard({ localPath: localRoot, endpoint });
    if (createdRoot) {
      output.write(`Created ${path.relative(process.cwd(), localRoot) || localRoot}\n`);
    }
    output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    output.write(`Built dashboard at ${path.relative(process.cwd(), result.dashboardPath) || result.dashboardPath}\n`);
    output.write(`Serve it from /${endpoint}/\n`);
    return;
  }

  if (command === "build" || command === "update" || command === "refresh") {
    const configured = await resolveConfiguredDashboard(args, envPath, { prompter: options.prompter });
    const localRoot = resolveDashboardRoot(configured.localPath);
    const createdRoot = await ensureDashboardRoot(localRoot, { prompter: options.prompter });
    const result = buildDashboard(configured);
    if (createdRoot) {
      output.write(`Created ${path.relative(process.cwd(), localRoot) || localRoot}\n`);
    }
    if (configured.prompted) {
      output.write(`Updated ${path.relative(process.cwd(), envPath) || ".env"}\n`);
    }
    output.write(`Built dashboard at ${path.relative(process.cwd(), result.dashboardPath) || result.dashboardPath}\n`);
    output.write(`Serve it from /${result.endpoint}/\n`);
    return;
  }

  if (command === "show" || command === "list") {
    const values = fs.existsSync(envPath)
      ? parseEnvContent(fs.readFileSync(envPath, "utf8"))
      : {};
    output.write(`${DASHBOARD_LOCAL_PATH_KEY}=${values[DASHBOARD_LOCAL_PATH_KEY] || ""}\n`);
    output.write(`${DASHBOARD_ENDPOINT_KEY}=${values[DASHBOARD_ENDPOINT_KEY] || ""}\n`);
    return;
  }

  throw new Error(`Unknown dashboard command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/dashboard-config.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  DASHBOARD_ENDPOINT_KEY,
  DASHBOARD_LOCAL_PATH_KEY,
  buildDashboard,
  createPrompter,
  main,
  normalizeDashboardEndpoint,
  parseArgs,
  showHelp,
};
