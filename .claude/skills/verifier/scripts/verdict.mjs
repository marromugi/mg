#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import process from "node:process";

const DESCRIPTION_LIMIT = 140;

const STATE_BY_RESULT = {
  pass: "success",
  "not-needed": "success",
  fail: "failure",
  unverifiable: "error",
};

const RESULTS_NEEDING_REASON = new Set(["fail", "unverifiable"]);

function describe(result, reason) {
  switch (result) {
    case "pass":
      return "合格";
    case "not-needed":
      return reason ? `確認不要: ${reason}` : "確認不要";
    case "fail":
      return `不合格: ${reason}`;
    case "unverifiable":
      return `確認できない: ${reason}`;
    default:
      throw new Error(`unknown result: ${result}`);
  }
}

function truncate(description) {
  if (description.length <= DESCRIPTION_LIMIT) return description;
  return `${description.slice(0, DESCRIPTION_LIMIT - 1)}…`;
}

function usage() {
  console.error(
    "Usage: node verdict.mjs <PR> <pass|fail|not-needed|unverifiable> [--reason <text>]",
  );
}

function parseArgs(argv) {
  const positional = [];
  let reason;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reason") {
      reason = argv[++i];
    } else {
      positional.push(argv[i]);
    }
  }
  const [pr, result] = positional;
  return { pr, result, reason };
}

function runGh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  if (result.error) {
    return { ok: false, output: result.error.message };
  }
  if (result.status !== 0) {
    return { ok: false, output: (result.stdout ?? "") + (result.stderr ?? "") };
  }
  return { ok: true, output: result.stdout ?? "" };
}

function main() {
  const { pr, result, reason } = parseArgs(process.argv.slice(2));

  if (!pr || !(result in STATE_BY_RESULT)) {
    usage();
    process.exit(2);
  }
  if (RESULTS_NEEDING_REASON.has(result) && !reason) {
    usage();
    process.exit(2);
  }

  const state = STATE_BY_RESULT[result];
  const description = truncate(describe(result, reason));

  const view = runGh(["pr", "view", pr, "--json", "headRefOid"]);
  if (!view.ok) {
    console.error(view.output);
    process.exit(1);
  }
  const { headRefOid } = JSON.parse(view.output);

  const post = runGh([
    "api",
    `repos/{owner}/{repo}/statuses/${headRefOid}`,
    "-f",
    `state=${state}`,
    "-f",
    "context=verifier",
    "-f",
    `description=${description}`,
  ]);
  if (!post.ok) {
    console.error(post.output);
    process.exit(1);
  }
}

main();
