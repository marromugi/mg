#!/usr/bin/env node
// Prints the developer's turns for one day, sorted by what an Estimator
// makes of them: likely overrides of the agent's design in full, everything
// else as one line.
//
//   node retrospect.mts [--date YYYY-MM-DD] [--threshold 0.3]
//                      [--exclude <session id>] [--dir <transcript dir>]
//                      [--all]
//
// Needs TYPESAFE_API_KEY and a built @mg/core. --all skips the Estimator and
// prints every turn in full.

import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createJevEstimator } from "../../../../packages/core/dist/index.js";
import { judgeTurns, type JudgedTurn } from "./judge.mts";
import { localDate, readTurns, type Turn } from "./turns.mts";

const AGENT_TEXT_LIMIT = 6000;
const USER_TEXT_LIMIT = 4000;

const { values } = parseArgs({
  options: {
    date: { type: "string" },
    threshold: { type: "string", default: "0.3" },
    exclude: { type: "string" },
    dir: { type: "string" },
    all: { type: "boolean", default: false },
  },
});

const threshold = Number(values.threshold);
if (!(threshold >= 0 && threshold <= 1)) {
  throw new Error(`--threshold must be between 0 and 1: ${values.threshold}`);
}

const date = values.date ?? localDate(new Date().toISOString());
const dir =
  values.dir ??
  join(
    homedir(),
    ".claude",
    "projects",
    process.cwd().replace(/[/.]/g, "-"),
  );

const clip = (text: string, limit: number, keep: "head" | "tail") => {
  if (text.length <= limit) return text;
  const cut = `[…${text.length - limit} chars cut]`;
  return keep === "tail"
    ? `${cut}\n${text.slice(-limit)}`
    : `${text.slice(0, limit)}\n${cut}`;
};

const score = (turn: Turn | JudgedTurn): string =>
  "override" in turn ? ` override ${turn.override.toFixed(2)}` : "";

const printFull = (turn: Turn | JudgedTurn): void => {
  console.log(
    `### ${turn.id} ${turn.time} (${turn.kind})${score(turn)}\n`,
  );
  console.log(
    `at ${turn.iso}${turn.skill ? `, last skill loaded: ${turn.skill}` : ""}`,
  );
  if (turn.interrupted) {
    console.log("The developer interrupted the agent just before this.");
  }
  console.log();
  if (turn.agent !== "") {
    console.log("Agent, just before:\n");
    console.log(
      clip(turn.agent, AGENT_TEXT_LIMIT, "tail").replace(/^/gm, "> "),
    );
    console.log();
  }
  console.log("Developer:\n");
  console.log(clip(turn.text, USER_TEXT_LIMIT, "head"));
  console.log();
};

const printLine = (turn: JudgedTurn): void => {
  const text = turn.text.replace(/\s+/g, " ").slice(0, 100);
  console.log(`- ${turn.id} ${turn.time}${score(turn)}: ${text}`);
};

const sessions = readTurns({ dir, date, exclude: values.exclude });
const turns = sessions.flatMap((session) => session.turns);

console.log(`# Developer turns on ${date}`);
console.log(`${sessions.length} sessions, ${turns.length} turns\n`);
for (const session of sessions) {
  console.log(
    `- ${session.id}${session.title ? ` — ${session.title}` : ""}`,
  );
}
console.log();

if (values.all) {
  turns.forEach(printFull);
} else {
  const apiKey = process.env["TYPESAFE_API_KEY"];
  if (apiKey === undefined || apiKey === "") {
    throw new Error("TYPESAFE_API_KEY is not set. Set it, or pass --all.");
  }
  const judged = await judgeTurns(createJevEstimator({ apiKey }), turns);
  // An answer given through a question tool is always shown: its options
  // are already structured, and the Estimator adds nothing to them.
  const isOverride = (turn: JudgedTurn): boolean =>
    turn.kind === "answer" || turn.override >= threshold;
  const overrides = judged.filter(isOverride);
  const rest = judged.filter((turn) => !isOverride(turn));

  console.log(`## Likely overrides (${overrides.length})\n`);
  overrides.forEach(printFull);
  console.log(`## Everything else (${rest.length})\n`);
  rest.forEach(printLine);
}
