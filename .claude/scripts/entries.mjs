#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseEnv } from "node:util";

const KNOWN_BURDENS = ["cost", "outside", "time", "hands"];
const CANDIDATE_ENTRY_EXTENSIONS = [".ts", ".mjs", ".js", ".cjs"];
const ENTRY_JSON_SUFFIX = ".entry.json";
const ALWAYS_LOADS_ENV_FILE = /--env-file(=|\s)/;

const COMMAND_OPTIONS = {
  show: ["env", "root"],
  check: ["root"],
};

const USAGE = {
  show: "Usage: node entries.mjs show <entry> [--env <path>] [--root <dir>]",
  check: "Usage: node entries.mjs check [--root <dir>]",
};

function usageError(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(command, argv) {
  const allowed = COMMAND_OPTIONS[command];
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (!allowed.includes(name)) usageError(USAGE[command]);
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("--")) {
        usageError(USAGE[command]);
      }
      options[name] = value;
      i++;
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function declarationPathFor(entry) {
  const ext = path.extname(entry);
  return entry.slice(0, entry.length - ext.length) + ENTRY_JSON_SUFFIX;
}

function toPosix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function readEnvFileKeys(envFile) {
  if (envFile === undefined) return {};
  let content;
  try {
    content = fs.readFileSync(envFile, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    console.log(`cannot read env file ${envFile}`);
    process.exit(1);
  }
  return parseEnv(content);
}

function isNeedPresent(need, fileKeys) {
  if (Object.hasOwn(process.env, need)) {
    return process.env[need] !== "";
  }
  if (Object.hasOwn(fileKeys, need)) {
    return fileKeys[need] !== "";
  }
  return false;
}

function show({ root, entry, envFile }) {
  const declarationPath = path.join(root, declarationPathFor(entry));
  if (!fs.existsSync(declarationPath)) {
    console.log(`no declaration for ${entry}`);
    process.exit(1);
  }
  const declaration = JSON.parse(fs.readFileSync(declarationPath, "utf8"));

  const fileKeys = readEnvFileKeys(envFile);
  const missing = declaration.needs.filter(
    (need) => !isNeedPresent(need, fileKeys),
  );

  console.log(
    JSON.stringify({
      entry,
      command: declaration.command,
      needs: declaration.needs,
      burdens: declaration.burdens,
      missing,
    }),
  );
}

function findDeclarationFiles(root) {
  const results = [];
  const skipDir = path.join(root, ".claude", "worktrees");
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = entry.name;
      if (name === "node_modules" || name === ".git") continue;
      const full = path.join(dir, name);
      if (full === skipDir) continue;
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && name.endsWith(ENTRY_JSON_SUFFIX)) {
        results.push(full);
      }
    }
  };
  walk(root);
  return results;
}

function validateDeclaration(declaration, label, base, root, problems) {
  if (
    typeof declaration.command !== "string" ||
    declaration.command === ""
  ) {
    problems.push(`${label}: command must be a non-empty string`);
  } else if (ALWAYS_LOADS_ENV_FILE.test(declaration.command)) {
    problems.push(
      `${label}: command must load env files with --env-file-if-exists`,
    );
  }

  if (
    !Array.isArray(declaration.needs) ||
    !declaration.needs.every((need) => typeof need === "string")
  ) {
    problems.push(`${label}: needs must be an array of strings`);
  }

  if (
    !Array.isArray(declaration.burdens) ||
    !declaration.burdens.every((burden) => typeof burden === "string")
  ) {
    problems.push(`${label}: burdens must be an array of strings`);
  } else {
    for (const burden of declaration.burdens) {
      if (!KNOWN_BURDENS.includes(burden)) {
        problems.push(`${label}: unknown burden "${burden}"`);
      }
    }
  }

  const hasEntryFile = CANDIDATE_ENTRY_EXTENSIONS.some((ext) =>
    fs.existsSync(base + ext),
  );
  if (!hasEntryFile) {
    const relativeBase = toPosix(path.relative(root, base));
    problems.push(
      `${label}: no entry file ${relativeBase}${CANDIDATE_ENTRY_EXTENSIONS[0]}`,
    );
  }
}

function check({ root }) {
  const files = findDeclarationFiles(root);
  const problems = [];

  for (const file of files) {
    const label = toPosix(path.relative(root, file));
    const base = file.slice(0, file.length - ENTRY_JSON_SUFFIX.length);

    let declaration;
    try {
      declaration = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      problems.push(`${label}: not valid JSON`);
      continue;
    }

    if (
      typeof declaration !== "object" ||
      declaration === null ||
      Array.isArray(declaration)
    ) {
      problems.push(`${label}: declaration must be an object`);
      continue;
    }

    validateDeclaration(declaration, label, base, root, problems);
  }

  if (problems.length === 0) {
    console.log(`ok: ${files.length} declarations`);
    process.exit(0);
  }

  for (const problem of problems) console.log(problem);
  process.exit(1);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "show") {
    const { positional, options } = parseArgs("show", rest);
    const [entry] = positional;
    if (entry === undefined) usageError(USAGE.show);
    const root = path.resolve(options.root ?? process.cwd());
    show({ root, entry, envFile: options.env });
    return;
  }

  if (command === "check") {
    const { options } = parseArgs("check", rest);
    const root = path.resolve(options.root ?? process.cwd());
    check({ root });
    return;
  }

  usageError("Usage: node entries.mjs <show|check> ...");
}

main();
