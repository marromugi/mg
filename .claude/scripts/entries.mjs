#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const KNOWN_BURDENS = ["cost", "outside", "time", "hands"];
const CANDIDATE_ENTRY_EXTENSIONS = [".ts", ".mjs", ".js", ".cjs"];
const ENTRY_JSON_SUFFIX = ".entry.json";

function usageError(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--env" || arg === "--root") {
      options[arg.slice(2)] = argv[++i];
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

function parseEnvFile(content) {
  const present = new Set();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value !== "") present.add(key);
  }
  return present;
}

function show({ root, entry, envFile }) {
  const declarationPath = path.join(root, declarationPathFor(entry));
  if (!fs.existsSync(declarationPath)) {
    console.log(`no declaration for ${entry}`);
    process.exit(1);
  }
  const declaration = JSON.parse(fs.readFileSync(declarationPath, "utf8"));

  let present = null;
  if (envFile !== undefined) {
    let content;
    try {
      content = fs.readFileSync(envFile, "utf8");
    } catch {
      console.log(`cannot read env file ${envFile}`);
      process.exit(1);
    }
    present = parseEnvFile(content);
  }

  const missing = declaration.needs.filter(
    (need) => present === null || !present.has(need),
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
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const full = path.join(dir, name);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
      } else if (name.endsWith(ENTRY_JSON_SUFFIX)) {
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
  }

  if (
    !Array.isArray(declaration.needs) ||
    !declaration.needs.every((need) => typeof need === "string")
  ) {
    problems.push(`${label}: needs must be an array of strings`);
  }

  if (Array.isArray(declaration.burdens)) {
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
    const declaration = JSON.parse(fs.readFileSync(file, "utf8"));
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
  const { positional, options } = parseArgs(rest);
  const root = path.resolve(options.root ?? process.cwd());

  if (command === "show") {
    const [entry] = positional;
    if (entry === undefined) usageError("Usage: node entries.mjs show <entry> [--env <path>] [--root <dir>]");
    show({ root, entry, envFile: options.env });
    return;
  }

  if (command === "check") {
    check({ root });
    return;
  }

  usageError("Usage: node entries.mjs <show|check> ...");
}

main();
