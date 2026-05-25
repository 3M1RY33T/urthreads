#!/usr/bin/env node

/**
 * Interactive setup for creating a local .env file.
 *
 * This script intentionally uses only Node built-ins so it can run immediately
 * after cloning the repository.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { buildWranglerTomlContent } = require("./wrangler-config");
const { writeExampleWorkerConfig } = require("./example-config");
const { formatHelp } = require("./help-format");

const DEFAULTS = {
  databaseName: "your-threads",
  workerName: "urthreads-worker",
  accountId: "",
  apiToken: "",
  databaseId: "",
  workerUrl: "",
  allowedOrigins: "https://example.com,https://www.example.com,http://localhost:8000,http://[::1]:8000",
  allowedOriginsStaging: "https://staging.example.com,http://localhost:3000,http://localhost:8000,http://[::1]:8000,http://localhost:8787",
  allowedOriginsProd: "https://example.com,https://www.example.com",
  maxCommentsPerPost: "100",
};

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildEndpointUrl(workerUrl, endpointPath) {
  const baseUrl = normalizeUrl(workerUrl);
  const cleanPath = String(endpointPath || "").startsWith("/")
    ? endpointPath
    : `/${endpointPath}`;

  return `${baseUrl}${cleanPath}`;
}

function sanitizeOriginList(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
    .join(",");
}

function normalizeWorkerName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildDefaultWorkerName(databaseName) {
  const baseName = normalizeWorkerName(databaseName || DEFAULTS.databaseName);

  return `${baseName || "urthreads"}-worker`;
}

function normalizeWorkersDevSubdomain(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\.workers\.dev\/?$/, "")
    .replace(/\/.*$/, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildDefaultWorkerUrl(workerName, workersDevSubdomain) {
  const normalizedWorkerName = normalizeWorkerName(workerName);
  const subdomain = normalizeWorkersDevSubdomain(workersDevSubdomain);
  if (!normalizedWorkerName || !subdomain) return "";
  return `https://${normalizedWorkerName}.${subdomain}.workers.dev`;
}

function envLine(key, value) {
  return `${key}=${String(value ?? "")}`;
}

function runWrangler(args, options = {}) {
  const runner = options.runner || spawnSync;
  return runner("wrangler", args, {
    encoding: "utf8",
    stdio: options.stdio || "pipe",
  });
}

function commandSucceeded(result) {
  return !result?.error && (typeof result?.status !== "number" || result.status === 0);
}

function getCommandOutput(result) {
  return `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
}

function redactSetupOutput(value) {
  return String(value || "")
    .replace(/\b[0-9a-f]{32}\b/gi, "<redacted-account-id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<redacted-id>")
    .replace(/(database_id\s*=\s*")[^"]+(")/gi, "$1<redacted-id>$2")
    .replace(/("database_id"\s*:\s*")[^"]+(")/gi, "$1<redacted-id>$2")
    .replace(/(CLOUDFLARE_API_TOKEN=)[^\s]+/gi, "$1<redacted>")
    .replace(/(ADMIN_API_KEY=)[^\s]+/gi, "$1<redacted>")
    .replace(/\/Users\/[^\s"']+/g, "<redacted-path>");
}

function summarizeWranglerFailure(output) {
  const text = String(output || "");
  const lower = text.toLowerCase();
  if (lower.includes("database with that name already exists")) {
    return "A D1 database with that name already exists, but setup could not read its ID automatically.";
  }
  if (lower.includes("not authenticated") || lower.includes("cloudflare_api_token")) {
    return "Wrangler is not authenticated for this command.";
  }
  if (lower.includes("permission") || lower.includes("forbidden") || lower.includes("unauthorized")) {
    return "Wrangler does not have permission to complete this command.";
  }
  return "Wrangler could not complete the command.";
}

function parseD1DatabaseId(output) {
  const text = String(output || "");
  const assignment = text.match(/database_id\s*=\s*"([^"]+)"/i);
  if (assignment) return assignment[1].trim();

  const jsonField = text.match(/"database_id"\s*:\s*"([^"]+)"/i);
  if (jsonField) return jsonField[1].trim();

  const uuid = text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  return uuid ? uuid[0] : "";
}

function getD1DatabaseIdFromRecord(record) {
  if (!record || typeof record !== "object") return "";
  return String(
    record.database_id ||
    record.uuid ||
    record.id ||
    record.uid ||
    ""
  ).trim();
}

function parseD1DatabaseList(output, databaseName) {
  const text = String(output || "");
  const targetName = String(databaseName || "").trim();
  if (!targetName) return "";

  try {
    const parsed = JSON.parse(text);
    const records = Array.isArray(parsed) ? parsed : parsed.result;
    if (Array.isArray(records)) {
      const match = records.find((record) => String(record?.name || record?.database_name || "").trim() === targetName);
      const databaseId = getD1DatabaseIdFromRecord(match);
      if (databaseId) return databaseId;
    }
  } catch (error) {
    // Wrangler text output is parsed below.
  }

  const escapedName = targetName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const nameThenId = new RegExp(`${escapedName}[\\s│|]+([0-9a-f-]{36})`, "i");
  const idThenName = new RegExp(`([0-9a-f-]{36})[\\s│|]+${escapedName}`, "i");
  const nameThenIdMatch = text.match(nameThenId);
  if (nameThenIdMatch) return nameThenIdMatch[1];
  const idThenNameMatch = text.match(idThenName);
  return idThenNameMatch ? idThenNameMatch[1] : "";
}

function isWranglerInstalled(options = {}) {
  return commandSucceeded(runWrangler(["--version"], options));
}

function isWranglerAuthenticated(options = {}) {
  const result = runWrangler(["whoami"], options);
  if (!commandSucceeded(result)) return false;

  const output = getCommandOutput(result).toLowerCase();
  return !(
    output.includes("you are not authenticated") ||
    output.includes("not authenticated") ||
    output.includes("please run `wrangler login`") ||
    output.includes("please run wrangler login")
  );
}

function createD1Database(databaseName, options = {}) {
  const result = runWrangler(["d1", "create", databaseName], options);
  const output = getCommandOutput(result);
  const databaseId = parseD1DatabaseId(output);
  if (commandSucceeded(result) && databaseId) {
    return {
      ok: true,
      databaseId,
      output,
      reused: false,
    };
  }

  if (output.toLowerCase().includes("database with that name already exists")) {
    const listResult = runWrangler(["d1", "list", "--json"], options);
    const listOutput = getCommandOutput(listResult);
    const existingDatabaseId = parseD1DatabaseList(listOutput, databaseName);
    if (commandSucceeded(listResult) && existingDatabaseId) {
      return {
        ok: true,
        databaseId: existingDatabaseId,
        output: `${output}\n${listOutput}`.trim(),
        reused: true,
      };
    }
  }

  return {
    ok: false,
    databaseId,
    output,
    reused: false,
  };
}

function initializeD1Schema(databaseName, options = {}) {
  const result = runWrangler(
    ["d1", "execute", databaseName, "--remote", "--file=src/schema.sql"],
    options
  );
  return {
    ok: commandSucceeded(result),
    output: getCommandOutput(result),
  };
}

function deployWorker(options = {}) {
  const result = runWrangler(["deploy"], options);
  return {
    ok: commandSucceeded(result),
    output: getCommandOutput(result),
  };
}

function buildEnvContent(config) {
  const workerUrl = normalizeUrl(config.workerUrl || DEFAULTS.workerUrl);
  const allowedOrigins = sanitizeOriginList(
    config.allowedOrigins || DEFAULTS.allowedOrigins
  );
  const allowedOriginsStaging = sanitizeOriginList(
    config.allowedOriginsStaging || DEFAULTS.allowedOriginsStaging
  );
  const allowedOriginsProd = sanitizeOriginList(
    config.allowedOriginsProd || DEFAULTS.allowedOriginsProd
  );

  return [
    "# urthreads environment",
    "# Generated by: urthreads setup-env",
    "# Never commit this file.",
    "",
    "# Cloudflare account credentials",
    envLine("CLOUDFLARE_ACCOUNT_ID", config.accountId),
    envLine("CLOUDFLARE_API_TOKEN", config.apiToken),
    "",
    "# D1 database",
    envLine("D1_DATABASE_NAME", config.databaseName || DEFAULTS.databaseName),
    envLine("D1_DATABASE_ID", config.databaseId),
    "",
    "# Worker deployment",
    envLine("WORKER_NAME", config.workerName || DEFAULTS.workerName),
    envLine("WORKER_URL", workerUrl),
    "",
    "# CORS",
    "# Use exact browser origins. Dashboard cookie sessions do not work with \"*\".",
    envLine("ALLOWED_ORIGINS", allowedOrigins),
    envLine("ALLOWED_ORIGINS_STAGING", allowedOriginsStaging),
    envLine("ALLOWED_ORIGINS_PROD", allowedOriginsProd),
    "",
    "# Client endpoint URLs",
    envLine("LIKES_ENDPOINT", workerUrl ? buildEndpointUrl(workerUrl, "/likes") : ""),
    envLine("COMMENTS_ENDPOINT", workerUrl ? buildEndpointUrl(workerUrl, "/comments") : ""),
    "",
    "# Admin dashboard",
    "# Generate/rotate with: urthreads admin-key",
    "# Store ADMIN_API_KEY as a Worker secret before using the dashboard.",
    envLine("ADMIN_API_KEY", config.adminApiKey || ""),
    envLine("ADMIN_API_KEY_EXPIRES_AT", config.adminApiKeyExpiresAt || ""),
    envLine("ADMIN_SESSION_TTL_SECONDS", config.adminSessionTtlSeconds || "3600"),
    "",
    "# Optional runtime settings",
    envLine("MAX_COMMENTS_PER_POST", config.maxCommentsPerPost || DEFAULTS.maxCommentsPerPost),
    "",
  ].join("\n");
}

function showHelp(commandName = "node src/setup-env.js") {
  process.stdout.write(formatHelp(`
urthreads .env Setup

USAGE:
  ${commandName}
  ${commandName} --help

DESCRIPTION:
  Starts an interactive setup that creates a local .env file for Cloudflare,
  D1, Worker deployment, CORS, and client endpoint values.
  When Wrangler is authenticated and a workers.dev subdomain is provided,
  setup can optionally initialize the D1 schema and deploy the Worker.

WHAT YOU NEED:
  - Wrangler installed and authenticated, or existing Cloudflare/D1 values
  - D1 database name
  - Worker URL after deployment, or your workers.dev subdomain to derive it
  - Allowed website origins for CORS

SAFETY:
  - Sensitive setup prompts are hidden while you type.
  - Never commit real .env files.
  - Existing .env files are not overwritten unless you confirm.

`));
}

function createPrompter(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });
  const originalWriteToOutput = rl._writeToOutput;

  function ask(question, defaultValue = "") {
    const suffix = defaultValue ? ` (${defaultValue})` : "";
    return new Promise((resolve) => {
      rl.question(`${question}${suffix}: `, (answer) => {
        const value = answer.trim();
        resolve(value || defaultValue);
      });
    });
  }

  function askHidden(question, defaultValue = "") {
    if (!input.isTTY || !output.isTTY) return ask(question, defaultValue);

    const suffix = defaultValue ? ` (${defaultValue})` : "";
    const prompt = `${question}${suffix}: `;

    return new Promise((resolve) => {
      let promptWritten = false;
      rl._writeToOutput = function writeHiddenPrompt(text) {
        if (!promptWritten && text === prompt) {
          promptWritten = true;
          output.write(text);
        }
      };

      rl.question(prompt, (answer) => {
        rl._writeToOutput = originalWriteToOutput;
        output.write("\n");
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
    askHidden,
    confirm,
    close: () => {
      rl._writeToOutput = originalWriteToOutput;
      rl.close();
    },
  };
}

async function collectConfig(prompter, output = process.stdout, options = {}) {
  output.write("\nurthreads .env setup\n");
  output.write("This will create a local .env file for deployment and CLI commands.\n\n");

  output.write("Before you start, make sure you have:\n");
  output.write("  1. A Cloudflare account\n");
  output.write("  2. Wrangler installed and authenticated: npm install -g wrangler && wrangler login\n");
  output.write("  3. A D1 database name you want to create or use, such as your-threads\n\n");

  let wranglerInstalled = false;
  let wranglerAuthenticated = false;
  if (options.useWrangler !== false) {
    wranglerInstalled = isWranglerInstalled(options);
    if (wranglerInstalled) {
      wranglerAuthenticated = isWranglerAuthenticated(options);
      if (!wranglerAuthenticated) {
        output.write("Wrangler is installed, but you do not appear to be authenticated.\n");
        const shouldLogin = await prompter.confirm("Run wrangler login now?", true);
        if (shouldLogin) {
          const loginResult = runWrangler(["login"], { ...options, stdio: "inherit" });
          if (commandSucceeded(loginResult)) {
            wranglerAuthenticated = isWranglerAuthenticated(options);
          } else {
            output.write("Wrangler login did not complete. You can continue with manual values.\n");
          }
        }
      }
    } else {
      output.write("Wrangler was not found. You can continue with manual Cloudflare and D1 values.\n");
    }
  }

  let accountId = "";
  let apiToken = "";
  if (wranglerAuthenticated) {
    output.write("Using local Wrangler authentication. Cloudflare account ID and API token can stay blank.\n");
    const shouldAddCloudflareValues = await prompter.confirm(
      "Add Cloudflare account ID or API token to .env anyway?",
      false
    );
    if (shouldAddCloudflareValues) {
      accountId = await prompter.askHidden(
        "Cloudflare account ID",
        DEFAULTS.accountId
      );

      output.write("\nCloudflare API token is optional if you use wrangler login locally.\n");
      output.write("If you enter one, it will be written to .env.\n");
      apiToken = await prompter.askHidden(
        "Cloudflare API token",
        DEFAULTS.apiToken
      );
    }
  } else {
    accountId = await prompter.askHidden(
      "Cloudflare account ID",
      DEFAULTS.accountId
    );

    output.write("\nCloudflare API token is optional if you use wrangler login locally.\n");
    output.write("If you enter one, it will be written to .env.\n");
    apiToken = await prompter.askHidden(
      "Cloudflare API token",
      DEFAULTS.apiToken
    );
  }

  output.write("\nD1 database\n");
  output.write("Example D1 database name: your-threads\n");
  const databaseName = await prompter.ask(
    "D1 database name to create or use",
    DEFAULTS.databaseName
  );

  let databaseId = "";
  if (wranglerInstalled && wranglerAuthenticated) {
    const shouldCreateDatabase = await prompter.confirm(
      `Create D1 database '${databaseName}' with Wrangler now?`,
      true
    );
    if (shouldCreateDatabase) {
      output.write(`Creating D1 database '${databaseName}' with Wrangler...\n`);
      const createdDatabase = createD1Database(databaseName, options);
      if (createdDatabase.ok && createdDatabase.databaseId) {
        databaseId = createdDatabase.databaseId;
        if (createdDatabase.reused) {
          output.write(`Using existing D1 database '${databaseName}'.\n`);
        } else {
          output.write(`Created D1 database '${databaseName}'.\n`);
        }
      } else {
        output.write(`${summarizeWranglerFailure(createdDatabase.output)}\n`);
        output.write("You can continue by pasting the existing D1 database ID into the next hidden prompt.\n");
        output.write("Find it with: wrangler d1 list\n");
        if (createdDatabase.output) {
          output.write("Sanitized Wrangler detail:\n");
          output.write(`${redactSetupOutput(createdDatabase.output)}\n`);
        }
      }
    }
  }

  if (!databaseId) {
    databaseId = await prompter.askHidden(
      "D1 database ID, if using an existing database",
      DEFAULTS.databaseId
    );
  }

  output.write("\nWorker deployment\n");
  const workerName = await prompter.ask("Worker name", buildDefaultWorkerName(databaseName));
  const workersDevSubdomain = await prompter.ask("Workers.dev subdomain, if known", "");
  const defaultWorkerUrl = buildDefaultWorkerUrl(workerName, workersDevSubdomain);
  if (defaultWorkerUrl) {
    output.write("A likely Worker URL was derived from your Worker name and workers.dev subdomain.\n");
    output.write("After deployment, double-check the deployed URL and update it if needed with:\n");
  } else {
    output.write("Leave Worker URL blank until after deployment if you do not know it yet.\n");
    output.write("After deployment, copy your deployed URL and set it with:\n");
  }
  output.write("urthreads env set WORKER_URL https://your-worker.workers.dev\n");
  const workerUrl = await prompter.ask("Worker URL", defaultWorkerUrl);

  output.write("\nCORS origins\n");
  output.write("Use comma-separated exact browser origins. Include your website and dashboard origins.\n");
  output.write("Avoid \"*\" because secure dashboard cookie sessions require a specific origin.\n");
  output.write("Example: https://example.com,https://www.example.com,http://localhost:8000\n");
  const allowedOrigins = await prompter.ask(
    "Allowed origins",
    DEFAULTS.allowedOrigins
  );
  const allowedOriginsStaging = await prompter.ask(
    "Staging allowed origins",
    DEFAULTS.allowedOriginsStaging
  );
  const allowedOriginsProd = await prompter.ask(
    "Production allowed origins",
    DEFAULTS.allowedOriginsProd
  );

  output.write("\nOptional settings\n");
  const maxCommentsPerPost = await prompter.ask(
    "Maximum comments returned per post",
    DEFAULTS.maxCommentsPerPost
  );

  return {
    accountId,
    apiToken,
    databaseName,
    databaseId,
    workerName,
    workerUrl,
    allowedOrigins,
    allowedOriginsStaging,
    allowedOriginsProd,
    maxCommentsPerPost,
    canOfferDeployment: Boolean(defaultWorkerUrl),
  };
}

async function offerDeploymentSteps(config, prompter, output = process.stdout, options = {}) {
  if (!config.canOfferDeployment || options.useWrangler === false) return false;

  output.write("\nDeployment\n");
  output.write("Because a workers.dev subdomain was provided, setup can initialize the D1 schema and deploy now.\n");
  const shouldRunDeployment = await prompter.confirm(
    "Initialize D1 schema and deploy Worker now?",
    false
  );
  if (!shouldRunDeployment) return false;

  const databaseName = config.databaseName || DEFAULTS.databaseName;
  output.write(`Initializing D1 schema for '${databaseName}'...\n`);
  const schemaResult = initializeD1Schema(databaseName, options);
  if (!schemaResult.ok) {
    output.write("D1 schema initialization did not complete.\n");
    if (schemaResult.output) {
      output.write("Sanitized Wrangler detail:\n");
      output.write(`${redactSetupOutput(schemaResult.output)}\n`);
    }
    return false;
  }
  output.write("Initialized D1 schema.\n");

  output.write("Deploying Worker...\n");
  const deployResult = deployWorker(options);
  if (!deployResult.ok) {
    output.write("Worker deployment did not complete.\n");
    if (deployResult.output) {
      output.write("Sanitized Wrangler detail:\n");
      output.write(`${redactSetupOutput(deployResult.output)}\n`);
    }
    return false;
  }
  output.write("Deployed Worker.\n");
  return true;
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "node src/setup-env.js";

  if (argv.includes("--help") || argv.includes("-h") || argv[0] === "help") {
    showHelp(commandName);
    return;
  }

  const envPath = path.resolve(process.cwd(), ".env");
  const prompter = options.prompter || createPrompter();
  const output = options.output || process.stdout;

  try {
    if (fs.existsSync(envPath)) {
      const shouldOverwrite = await prompter.confirm(
        ".env already exists. Overwrite it?",
        false
      );

      if (!shouldOverwrite) {
        output.write("Setup cancelled. Existing .env was left unchanged.\n");
        return;
      }
    }

    const config = await collectConfig(prompter, output, options);
    const content = buildEnvContent(config);

    fs.writeFileSync(envPath, content, { encoding: "utf8", mode: 0o600 });

    output.write("\nCreated .env\n");
    const exampleConfigPath = writeExampleWorkerConfig(config.workerUrl, {
      generatedBy: "urthreads setup-env",
    });
    output.write(`Updated ${path.relative(process.cwd(), exampleConfigPath)}\n`);

    const wranglerPath = path.resolve(process.cwd(), "wrangler.toml");
    const shouldCreateWrangler = await prompter.confirm(
      "Create wrangler.toml from these answers too?",
      true
    );

    if (shouldCreateWrangler) {
      let shouldWriteWrangler = true;
      if (fs.existsSync(wranglerPath)) {
        shouldWriteWrangler = await prompter.confirm(
          "wrangler.toml already exists. Overwrite it?",
          false
        );
      }

      if (shouldWriteWrangler) {
        fs.writeFileSync(wranglerPath, buildWranglerTomlContent(config), {
          encoding: "utf8",
        });
        output.write("Created wrangler.toml\n");
      } else {
        output.write("Existing wrangler.toml was left unchanged.\n");
      }
    }

    const deploymentCompleted = await offerDeploymentSteps(config, prompter, output, options);

    output.write("\n");
    output.write("Next steps:\n");
    if (!deploymentCompleted) {
      output.write(`  1. Initialize D1 schema: wrangler d1 execute ${config.databaseName || DEFAULTS.databaseName} --remote --file=src/schema.sql\n`);
      output.write("  2. Deploy: wrangler deploy\n");
      output.write("  3. Point your site scripts at the deployed Worker endpoints\n\n");
    } else {
      output.write("  1. Double-check the deployed Worker URL in Cloudflare or Wrangler output.\n");
      output.write("  2. Point your site scripts at the deployed Worker endpoints.\n\n");
    }
  } finally {
    if (!options.prompter) prompter.close();
  }
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/setup-env.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  DEFAULTS,
  buildEndpointUrl,
  buildEnvContent,
  buildDefaultWorkerName,
  buildDefaultWorkerUrl,
  collectConfig,
  createPrompter,
  createD1Database,
  deployWorker,
  initializeD1Schema,
  isWranglerAuthenticated,
  isWranglerInstalled,
  main,
  normalizeUrl,
  parseD1DatabaseId,
  parseD1DatabaseList,
  offerDeploymentSteps,
  redactSetupOutput,
  sanitizeOriginList,
  summarizeWranglerFailure,
  showHelp,
};
