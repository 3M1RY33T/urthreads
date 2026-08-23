#!/usr/bin/env node

/**
 * One-command local admin development setup: creates/updates a local .dev.vars
 * with a never-expiring admin key and initializes the local D1 schema.
 *
 * No Cloudflare account, CLOUDFLARE_API_TOKEN, or network access is required.
 * This script writes ONLY the gitignored .dev.vars file (see .gitignore) and
 * runs `wrangler d1 execute --local` for the local sqlite replica. It never
 * edits wrangler.toml and never calls wrangler secret put, wrangler deploy, or
 * remote D1.
 *
 * Uses only Node built-ins (and the clipboard helper from src/admin-key.js) so
 * it runs immediately after `npm install`.
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");
const { generateAdminApiKey, copyToClipboard, upsertEnvVars } = require("./admin-key");

const ADMIN_KEY_NAME = "ADMIN_API_KEY";
const ADMIN_KEY_EXPIRES_AT_NAME = "ADMIN_API_KEY_EXPIRES_AT";
const DEV_VARS_FILE = ".dev.vars";
const DEFAULT_WRANGLER_FILE = "wrangler.toml";
const SCHEMA_FILE = "src/schema.sql";

/**
 * Extract the first top-level D1 database_name from wrangler.toml content.
 * Ignores per-env [[env.*.d1_databases]] blocks. Returns "" when absent.
 */
function parseD1DatabaseName(content) {
  const lines = String(content || "").split(/\r?\n/);
  let inTopLevelD1 = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Any table header ends the current top-level d1 block.
    const headerMatch = line.match(/^(\[\[?[^\]]*\]\]?)\s*(?:#.*)?$/);
    if (headerMatch) {
      inTopLevelD1 = /^\[\[d1_databases\]\]\s*$/.test(headerMatch[1]);
      continue;
    }

    if (inTopLevelD1) {
      const nameMatch = line.match(/^database_name\s*=\s*"([^"]+)"\s*(?:#.*)?$/);
      if (nameMatch) return nameMatch[1].trim();
    }
  }

  return "";
}

/**
 * Read the top-level D1 database name from wrangler.toml at `wranglerPath`.
 * Throws a helpful Error when the file or binding is missing.
 */
function readD1DatabaseName(wranglerPath) {
  const resolved = path.resolve(wranglerPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Could not find ${path.basename(resolved)}. Run "npm run setup:env" first to create your Worker configuration.`
    );
  }

  const content = fs.readFileSync(resolved, "utf8");
  const databaseName = parseD1DatabaseName(content);
  if (!databaseName) {
    throw new Error(
      `No top-level [[d1_databases]] database_name found in ${path.basename(resolved)}. Run "npm run setup:env" to configure D1.`
    );
  }

  return databaseName;
}

/**
 * Validate an expiry value using the worker's fail-closed semantics: empty/
 * unset/never/none are not-expired; an unparseable value is an error; a parseable
 * past value should be warned about. Returns { ok, expired, message }.
 */
function validateAdminKeyExpiry(value, now = Date.now()) {
  const expiresAt = String(value || "").trim();
  const normalized = expiresAt.toLowerCase();

  if (!expiresAt || normalized === "never" || normalized === "none") {
    return { ok: true, expired: false, message: "" };
  }

  const timestamp = Date.parse(expiresAt);
  if (Number.isNaN(timestamp)) {
    return { ok: false, expired: true, message: `ADMIN_API_KEY_EXPIRES_AT is not parseable ("${expiresAt}") and would fail closed in the Worker.` };
  }

  if (timestamp <= now) {
    return { ok: true, expired: true, message: `A previously set ADMIN_API_KEY_EXPIRES_AT (${expiresAt}) was in the past and would have expired your local key; it was reset.` };
  }

  return { ok: true, expired: false, message: "" };
}

/**
 * Run the local D1 schema initialization for `databaseName`.
 * `exec` is injectable for tests; by default it uses child_process.execSync.
 */
function runLocalSchema(databaseName, options = {}) {
  const exec = options.exec || ((command) => childProcess.execSync(command, { encoding: "utf8", stdio: "pipe" }));
  const command = `npx wrangler d1 execute ${databaseName} --local --file=${SCHEMA_FILE}`;

  try {
    exec(command);
    return { ok: true, output: "" };
  } catch (error) {
    const stderr = String(error && error.stderr ? error.stderr : (error && error.message) || error);
    const stdout = String(error && error.stdout ? error.stdout : "");
    const output = `${stdout}\n${stderr}`.trim();

    if (/wrangler[^\n]{0,40}not found|cannot find module|'wrangler' is not recognized|Executable.*wrangler/i.test(output) &&
        /command not found|ENOENT|not recognized/i.test(output)) {
      return {
        ok: false,
        output,
        message: "Wrangler is not installed. Run \"npm install\" first (it installs wrangler as a devDependency).",
      };
    }

    return {
      ok: false,
      output,
      message: "Local D1 schema initialization failed. This does not affect your deployed Worker. See the wrangler output below.",
    };
  }
}

/**
 * Parse a .dev.vars-style content string into a flat key/value map, stripping
 * surrounding double quotes from values.
 */
function readDevVars(content) {
  const values = {};
  for (const rawLine of String(content || "").split(/\r?\n/)) {
    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (match) {
      let value = match[2].trim();
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      values[match[1]] = value;
    }
  }
  return values;
}

/**
 * Build the .dev.vars content: reuse the existing key (or generate one) and
 * ALWAYS write an empty expiry so the local Worker never treats the key as
 * expired. Returns { content, reusedKey, overwroteExpiry, expiredWarning }.
 */
function prepareDevVarsContent(existingContent, adminKey) {
  const current = readDevVars(existingContent);
  const reusedKey = Boolean(current[ADMIN_KEY_NAME]);
  const previousExpiry = current[ADMIN_KEY_EXPIRES_AT_NAME];
  const overwroteExpiry = Boolean(previousExpiry && String(previousExpiry).trim() !== "");

  const content = upsertEnvVars(existingContent, {
    [ADMIN_KEY_NAME]: adminKey,
    [ADMIN_KEY_EXPIRES_AT_NAME]: "",
  });

  const expiredWarning = validateAdminKeyExpiry(previousExpiry).message;

  return { content, reusedKey, overwroteExpiry, expiredWarning };
}

function main(argv = process.argv.slice(2), options = {}) {
  const output = options.output || process.stdout;
  const cwd = options.cwd || process.cwd();

  const wranglerPath = path.resolve(cwd, options.wranglerPath || DEFAULT_WRANGLER_FILE);
  const devVarsPath = path.resolve(cwd, DEV_VARS_FILE);

  let databaseName;
  try {
    databaseName = readD1DatabaseName(wranglerPath);
  } catch (error) {
    output.write(`\n${error.message}\n\n`);
    return { ok: false, reason: "no_d1_database" };
  }

  const existingContent = fs.existsSync(devVarsPath) ? fs.readFileSync(devVarsPath, "utf8") : "";
  const existingKey = readDevVars(existingContent)[ADMIN_KEY_NAME];
  const adminKey =
    existingKey ||
    (options.generateAdminApiKey || generateAdminApiKey)();
  const prepared = prepareDevVarsContent(existingContent, adminKey);

  fs.writeFileSync(devVarsPath, prepared.content, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(devVarsPath, 0o600);
  } catch (error) {
    // Best-effort hardening for platforms that support POSIX modes.
  }

  output.write(`\nUpdated ${path.relative(cwd, devVarsPath) || DEV_VARS_FILE}\n`);
  if (prepared.reusedKey) {
    output.write(`Reused the existing ${ADMIN_KEY_NAME} from .dev.vars.\n`);
  } else {
    output.write(`Generated a new ${ADMIN_KEY_NAME} for local development.\n`);
  }
  output.write(`${ADMIN_KEY_EXPIRES_AT_NAME}= (never) so the local Worker can never reject it as expired.\n`);
  if (prepared.expiredWarning) {
    output.write(`\nNote: ${prepared.expiredWarning}\n`);
  }

  const copyResult = (options.copyToClipboard || copyToClipboard)(adminKey);
  if (copyResult.copied) {
    output.write(`Copied the admin key to your clipboard.\n`);
  }

  output.write("\nInitializing local D1 schema...\n");
  const schemaResult = runLocalSchema(databaseName, options);
  if (!schemaResult.ok) {
    output.write(`\n${schemaResult.message}\n`);
    if (schemaResult.output) output.write(`${schemaResult.output}\n`);
  } else {
    output.write("Local D1 schema is ready.\n");
  }

  output.write("\nAdmin key for the dashboard:\n");
  output.write(`  ${adminKey}\n`);

  output.write("\nNext steps:\n");
  output.write("  1. Start the local Worker: npm run dev\n");
  output.write("     (If npm run dev was already running, restart it so it reads the new .dev.vars.)\n");
  output.write("  2. Serve the dashboard: python3 -m http.server 8000\n");
  output.write("  3. Open http://localhost:8000/web/index.html\n");
  output.write("  4. Worker URL: http://localhost:8787, admin key: the value above.\n\n");

  return { ok: true, adminKey, databaseName, reusedKey: prepared.reusedKey };
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  ADMIN_KEY_EXPIRES_AT_NAME,
  ADMIN_KEY_NAME,
  DEV_VARS_FILE,
  main,
  parseD1DatabaseName,
  prepareDevVarsContent,
  readD1DatabaseName,
  readDevVars,
  runLocalSchema,
  validateAdminKeyExpiry,
};
