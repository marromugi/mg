#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const CHILD_H2 = ["Request", "Design", "Decided", "Verification", "To Implementer"];
const PARENT_H2 = ["Request", "Design", "Decided", "Child issues"];
const GOAL_H2 = ["Asked", "Request", "Verification", "Known", "Open questions", "Bounds"];
const NONE = "None";

const file = process.argv[2];
if (!file) {
  console.error("Usage: node check-issue.mjs <body.md>");
  process.exit(2);
}

const problems = [];
const fail = (line, message) => problems.push(`${file}:${line}: ${message}`);

const sections = [];
let fence = false;
fs.readFileSync(file, "utf8")
  .split(/\r?\n/)
  .forEach((text, i) => {
    const n = i + 1;
    if (/^```/.test(text)) fence = !fence;
    if (fence) return;
    const h2 = /^## (.+?)\s*$/.exec(text);
    if (h2) {
      sections.push({ title: h2[1], n, lines: [] });
      return;
    }
    sections.at(-1)?.lines.push({ n, text });
  });

const find = (title) => sections.find((s) => s.title === title);
const bullets = (lines) =>
  lines
    .map(({ n, text }) => ({ n, item: /^- (.*)$/.exec(text)?.[1] }))
    .filter((b) => b.item !== undefined);

const requireInOrder = (titles) => {
  let last = -1;
  for (const title of titles) {
    const at = sections.findIndex((s) => s.title === title);
    if (at === -1) fail(1, `missing section "## ${title}"`);
    else if (at < last) fail(sections[at].n, `"## ${title}" is out of order`);
    else last = at;
  }
};

const isChild = Boolean(find("To Implementer"));
const isParent = Boolean(find("Child issues"));
const isGoal = Boolean(find("Open questions"));

if (isGoal && (isChild || isParent)) {
  fail(
    find("Open questions").n,
    'a body with "## Open questions" has no "## To Implementer" or "## Child issues"',
  );
} else if (isChild && isParent) {
  fail(find("Child issues").n, 'a body with "## To Implementer" has no "## Child issues"');
} else if (isChild) requireInOrder(CHILD_H2);
else if (isParent) requireInOrder(PARENT_H2);
else if (isGoal) requireInOrder(GOAL_H2);
else
  fail(
    1,
    'none of "## To Implementer", "## Child issues", "## Open questions": not an architect issue',
  );

if (isGoal) {
  const asked = find("Asked");
  if (asked && !asked.lines.some(({ text }) => text.trim() !== "")) {
    fail(asked.n, '"Asked" needs the words the work came from');
  }
  for (const title of ["Known", "Open questions", "Bounds"]) {
    const section = find(title);
    if (section && bullets(section.lines).length === 0) {
      fail(section.n, `"${title}" needs items, or "- None"`);
    }
  }
}

const parentAttempts = (find("Design")?.lines ?? []).filter(({ text }) =>
  /^\s*parent\s*:/i.test(text),
);
parentAttempts.forEach(({ n, text }, i) => {
  if (!/^Parent: #\d+$/.test(text)) fail(n, 'Parent line is not "Parent: #<n>"');
  if (i > 0) fail(n, 'more than one Parent line in "## Design"');
  if (isParent) fail(n, "a Parent line in a parent issue");
});

const decided = find("Decided");
if (decided && bullets(decided.lines).length === 0) {
  fail(decided.n, '"Decided" needs items, or "- None"');
}

const checks = find("Verification");
if (checks) {
  const items = bullets(checks.lines);
  const used = new Map();
  if (items.length === 0) fail(checks.n, '"Verification" needs items, or "- None"');

  for (const { n, item } of items) {
    if (item === NONE || /^None: \S/.test(item)) {
      if (isGoal) fail(n, 'a goal needs a runnable check in "Verification"');
      else if (items.length > 1) fail(n, '"None" must be the only item in "Verification"');
      continue;
    }
    const m = /^(V\d+): (\S.*)$/.exec(item);
    if (!m) {
      fail(n, 'check is not "V<n>: <entry> ..." or "None: <reason>"');
      continue;
    }
    if (!/`[^`]+`/.test(m[2])) fail(n, `${m[1]} names no entry in backticks`);
    if (used.has(m[1])) fail(n, `${m[1]} is already used on line ${used.get(m[1])}`);
    else used.set(m[1], n);
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${file}: ok`);
