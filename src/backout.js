#!/usr/bin/env node

/**
 * Back-out helpers for resetting local urthreads setup state.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");
const { readEnvValues } = require("./env-config");
const { getWranglerValue, normalizeEnvName } = require("./wrangler-config");
const { formatHelp } = require("./help-format");

const ENVIRONMENT_FILES = [".env", "wrangler.toml", ".dev.vars"];
const LOCAL_WORKING_FILES = [
  "dist",
  "build",
  "coverage",
  ".nyc_output",
  "npm-debug.log",
  "yarn-debug.log",
  "yarn-error.log",
  "pnpm-debug.log",
];
const CACHE_PATHS = [
  ".wrangler",
  ".mf",
  ".cache",
  ".parcel-cache",
  ".vite",
  path.join("node_modules", ".cache"),
  path.join("web", ".cache"),
  path.join("examples", ".cache"),
];

function createPrompter(input = process.stdin, output = process.stdout) {
  const rl = readline.createInterface({ input, output });

  function ask(question) {
    return new Promise((resolve) => {
      rl.question(question, (answer) => resolve(String(answer || "").trim()));
    });
  }

  async function confirm(question, defaultValue = false) {
    const label = defaultValue ? "Y/n" : "y/N";
    const answer = (await ask(`${question} [${label}]: `)).toLowerCase();
    if (!answer) return defaultValue;
    return answer === "y" || answer === "yes";
  }

  async function confirmText(question, expected) {
    const answer = await ask(`${question}: `);
    return answer === expected;
  }

  return {
    ask,
    confirm,
    confirmText,
    close: () => rl.close(),
  };
}

function parseArgs(argv = []) {
  const result = {
    command: argv[0] || "",
    yes: false,
    dryRun: false,
    includeCache: false,
    includeEnv: false,
    includeWrangler: false,
    deleteWorker: false,
    keepLocal: false,
    workerName: "",
    envName: "default",
    envPath: ".env",
    wranglerPath: "wrangler.toml",
    help: false,
  };

  if (result.command === "--help" || result.command === "-h" || result.command === "help") {
    result.help = true;
  }

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h" || arg === "help") {
      result.help = true;
    } else if (arg === "--yes" || arg === "-y") {
      result.yes = true;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    } else if (arg === "--cache" || arg === "--include-cache") {
      result.includeCache = true;
    } else if (arg === "--env-file" || arg === "--include-env") {
      result.includeEnv = true;
    } else if (arg === "--wrangler" || arg === "--include-wrangler") {
      result.includeWrangler = true;
    } else if (arg === "--delete-worker") {
      result.deleteWorker = true;
    } else if (arg === "--keep-local") {
      result.keepLocal = true;
    } else if (arg === "--name" || arg === "--worker") {
      result.workerName = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--name=")) {
      result.workerName = arg.slice("--name=".length);
    } else if (arg.startsWith("--worker=")) {
      result.workerName = arg.slice("--worker=".length);
    } else if (arg === "--env") {
      result.envName = argv[index + 1] || result.envName;
      index += 1;
    } else if (arg.startsWith("--env=")) {
      result.envName = arg.slice("--env=".length);
    } else if (arg === "--env-path") {
      result.envPath = argv[index + 1] || result.envPath;
      index += 1;
    } else if (arg.startsWith("--env-path=")) {
      result.envPath = arg.slice("--env-path=".length);
    } else if (arg === "--wrangler-path" || arg === "--toml") {
      result.wranglerPath = argv[index + 1] || result.wranglerPath;
      index += 1;
    } else if (arg.startsWith("--wrangler-path=")) {
      result.wranglerPath = arg.slice("--wrangler-path=".length);
    } else if (arg.startsWith("--toml=")) {
      result.wranglerPath = arg.slice("--toml=".length);
    }
  }

  return result;
}

function relativeTarget(filePath, cwd = process.cwd()) {
  return path.relative(cwd, filePath) || path.basename(filePath);
}

function existingPaths(paths, cwd = process.cwd()) {
  return paths
    .map((item) => path.resolve(cwd, item))
    .filter((filePath) => fs.existsSync(filePath));
}

function removePaths(paths, options = {}) {
  const cwd = options.cwd || process.cwd();
  const output = options.output || process.stdout;
  const removed = [];
  const skipped = [];

  for (const filePath of paths) {
    const label = relativeTarget(filePath, cwd);
    if (!fs.existsSync(filePath)) {
      skipped.push(label);
      continue;
    }

    if (options.dryRun) {
      output.write(`[dry-run] Would remove ${label}\n`);
    } else {
      fs.rmSync(filePath, { recursive: true, force: true });
      output.write(`Removed ${label}\n`);
    }
    removed.push(label);
  }

  return { removed, skipped };
}

function buildCleanTargets(args, cwd = process.cwd()) {
  const targets = [];
  const command = args.command;

  if (command === "clean") {
    targets.push(...LOCAL_WORKING_FILES, ...CACHE_PATHS);
  } else if (command === "clean-cache") {
    targets.push(...CACHE_PATHS);
  } else if (command === "clean-env") {
    targets.push(args.envPath, args.wranglerPath);
  } else if (command === "clean-all") {
    targets.push(...LOCAL_WORKING_FILES, ...CACHE_PATHS, ...ENVIRONMENT_FILES, args.envPath, args.wranglerPath);
  } else {
    targets.push(...ENVIRONMENT_FILES);
    if (args.includeCache) targets.push(...CACHE_PATHS);
  }

  if (args.includeEnv && !targets.includes(args.envPath)) targets.push(args.envPath);
  if (args.includeWrangler && !targets.includes(args.wranglerPath)) targets.push(args.wranglerPath);

  return existingPaths(Array.from(new Set(targets)), cwd);
}

function buildFullCleanTargets(args, cwd = process.cwd()) {
  const targets = [
    ...ENVIRONMENT_FILES,
    ...LOCAL_WORKING_FILES,
    ...CACHE_PATHS,
    args.envPath,
    args.wranglerPath,
  ];
  return existingPaths(Array.from(new Set(targets)), cwd);
}

function inferWorkerName(args, cwd = process.cwd()) {
  if (args.workerName) return args.workerName;

  const wranglerPath = path.resolve(cwd, args.wranglerPath);
  if (fs.existsSync(wranglerPath)) {
    const content = fs.readFileSync(wranglerPath, "utf8");
    const fromWrangler = getWranglerValue(content, "name", args.envName);
    if (fromWrangler) return fromWrangler;
  }

  const envPath = path.resolve(cwd, args.envPath);
  const fromEnv = readEnvValues(envPath).WORKER_NAME;
  return fromEnv ? String(fromEnv).trim() : "";
}

async function confirmLocalRemoval(targets, args, prompter, output, cwd = process.cwd()) {
  if (targets.length === 0) return true;

  output.write("This will remove local generated files only:\n");
  for (const filePath of targets) {
    output.write(`  - ${relativeTarget(filePath, cwd)}\n`);
  }
  output.write("Templates in config/ are not removed.\n");

  if (args.yes || args.dryRun) return true;
  return prompter.confirm("Continue with local cleanup?", false);
}

async function cleanLocalState(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const output = options.output || process.stdout;
  const prompter = options.prompter || createPrompter();
  const targets = options.targets || buildCleanTargets(args, cwd);

  try {
    if (targets.length === 0) {
      output.write("No matching local files or caches found.\n");
      return { removed: [], skipped: [] };
    }

    const confirmed = await confirmLocalRemoval(targets, args, prompter, output, cwd);
    if (!confirmed) {
      output.write("Local cleanup cancelled.\n");
      return { removed: [], skipped: [] };
    }

    return removePaths(targets, { cwd, output, dryRun: args.dryRun });
  } finally {
    if (!options.prompter) prompter.close();
  }
}

function runWranglerDelete(workerName, args, options = {}) {
  const runner = options.runner || spawnSync;
  const output = options.output || process.stdout;
  const envName = normalizeEnvName(args.envName);
  const commandArgs = ["delete", workerName];
  if (envName !== "default") commandArgs.push("--env", envName);

  if (args.dryRun) {
    output.write(`[dry-run] Would run: wrangler ${commandArgs.join(" ")}\n`);
    return { status: 0 };
  }

  return runner("wrangler", commandArgs, { stdio: "inherit" });
}

async function deleteWorker(args, options = {}) {
  const cwd = options.cwd || process.cwd();
  const output = options.output || process.stdout;
  const prompter = options.prompter || createPrompter();
  const workerName = inferWorkerName(args, cwd);

  try {
    if (!workerName) {
      throw new Error("Unable to infer Worker name. Pass --name <worker-name>.");
    }

    output.write(`WARNING: This deletes the deployed Cloudflare Worker '${workerName}'.\n`);
    output.write("It does not delete D1 databases, local files, or npm package data.\n");

    if (!args.yes && !args.dryRun) {
      const expected = `delete ${workerName}`;
      const confirmed = await prompter.confirmText(
        `Type '${expected}' to confirm Worker deletion`,
        expected
      );
      if (!confirmed) {
        output.write("Worker deletion cancelled.\n");
        return { deleted: false, workerName };
      }
    }

    const result = runWranglerDelete(workerName, args, {
      output,
      runner: options.runner,
    });
    if (result?.error) throw result.error;
    if (typeof result?.status === "number" && result.status !== 0) {
      throw new Error(`wrangler delete failed with exit code ${result.status}.`);
    }
    output.write(`${args.dryRun ? "Checked" : "Deleted"} Worker ${workerName}\n`);

    if (!args.keepLocal) {
      const cleanupTargets = buildFullCleanTargets(args, cwd);
      if (cleanupTargets.length > 0) {
        output.write("\nRecommended next step: clean local environment, cache, and working files that reference this Worker.\n");
        let shouldClean = args.yes || args.dryRun;
        if (!shouldClean) {
          shouldClean = await prompter.confirm(
            "Clean local environment, cache, and working files now?",
            true
          );
        }

        if (shouldClean) {
          await cleanLocalState(
            { ...args, command: "clean-files", includeCache: true },
            { ...options, prompter, targets: cleanupTargets }
          );
        } else {
          output.write("Local files were left unchanged.\n");
        }
      }
    }

    return { deleted: true, workerName };
  } finally {
    if (!options.prompter) prompter.close();
  }
}

function showHelp(commandName = "urthreads backout") {
  process.stdout.write(formatHelp(`
urthreads Back-Out Commands

USAGE:
  ${commandName} clean-files [--cache] [--dry-run] [--yes]
  ${commandName} clean [--dry-run] [--yes]
  ${commandName} clean-all [--delete-worker] [--dry-run] [--yes]
  ${commandName} clean-cache [--dry-run] [--yes]
  ${commandName} delete-worker [--name <worker>] [--env staging|production] [--dry-run] [--yes] [--keep-local]
  ${commandName} clean-env [--delete-worker] [--dry-run] [--yes]

DESCRIPTION:
  Removes generated local setup files and caches so you can test setup from
  a clean state. Destructive Cloudflare Worker deletion requires a warning
  confirmation unless --yes is provided.

COMMANDS:
  clean             Remove caches and local working files, keeping database and configuration
  clean-all         Remove caches, working files, and environment files; optionally delete Worker
  clean-files       Remove local generated environment files: .env, wrangler.toml, .dev.vars
  clean-cache       Remove local cache directories such as .wrangler and node_modules/.cache
  delete-worker     Delete the deployed Cloudflare Worker, then recommend full local cleanup
  clean-env         Remove .env and wrangler.toml, then optionally delete the Worker

`));
}

async function main(argv = process.argv.slice(2), options = {}) {
  const commandName = options.commandName || "urthreads backout";
  const output = options.output || process.stdout;
  const cwd = options.cwd || process.cwd();
  const args = parseArgs(argv);
  const command = args.command;

  if (!command || args.help || command === "help") {
    showHelp(commandName);
    return;
  }

  if (command === "delete-worker") {
    await deleteWorker(args, options);
    return;
  }

  if (command === "clean" || command === "clean-files" || command === "clean-cache" || command === "clean-env" || command === "clean-all") {
    const prompter = options.prompter || createPrompter();
    try {
      if (command === "clean-env" || command === "clean-all") {
        let shouldDeleteWorker = args.deleteWorker;
        if (!args.deleteWorker && !args.yes && !args.dryRun) {
          shouldDeleteWorker = await prompter.confirm(
            "Also delete the deployed Cloudflare Worker?",
            false
          );
        }
        if (shouldDeleteWorker) {
          await deleteWorker({ ...args, keepLocal: true }, { ...options, prompter });
        }
      }

      await cleanLocalState(args, { ...options, prompter });
    } finally {
      if (!options.prompter) prompter.close();
    }
    return;
  }

  throw new Error(`Unknown back-out command: ${command}`);
}

if (require.main === module) {
  main(process.argv.slice(2), { commandName: "node src/backout.js" }).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}

module.exports = {
  CACHE_PATHS,
  ENVIRONMENT_FILES,
  LOCAL_WORKING_FILES,
  buildCleanTargets,
  buildFullCleanTargets,
  cleanLocalState,
  createPrompter,
  deleteWorker,
  inferWorkerName,
  main,
  parseArgs,
  removePaths,
  showHelp,
};
