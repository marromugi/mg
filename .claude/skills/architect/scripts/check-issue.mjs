#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const CHILD_H2 = [
  "Background",
  "Design",
  "Changes",
  "Constraints",
  "Cases",
  "Verification",
  "To Implementer",
];
const RECORD_H2 = [
  "Decision",
  "Behaviour changes",
  "Place in the whole",
  "Confirmed facts",
  "Reasons",
  "Rejected shapes",
  "Trade-offs",
];
const KINDS = [
  ["Behaviour", "B"],
  ["Structure", "S"],
  ["Direction", "D"],
];
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
const hasRecord = Boolean(find("Decision"));
const isParent = hasRecord && !isChild;

if (!isChild && !hasRecord) {
  fail(1, 'neither "## To Implementer" nor "## Decision": not an architect issue');
}
if (isChild) requireInOrder(CHILD_H2);
if (hasRecord) requireInOrder(RECORD_H2);
if (isParent && !find("Child issues")) fail(1, 'missing section "## Child issues"');

const parentAttempts = (find("Design")?.lines ?? []).filter(({ text }) =>
  /^\s*parent\s*:/i.test(text),
);
parentAttempts.forEach(({ n, text }, i) => {
  if (!/^Parent: #\d+$/.test(text)) fail(n, 'Parent line is not "Parent: #<n>"');
  if (i > 0) fail(n, 'more than one Parent line in "## Design"');
  if (hasRecord) fail(n, "a Parent line in a body that holds its own decision record");
});

for (const title of ["Reasons", "Rejected shapes"]) {
  for (const { n, item } of bullets(find(title)?.lines ?? [])) {
    if (item !== NONE && !/Principle ?\d/.test(item)) {
      fail(n, `"${title}" item cites no principle`);
    }
  }
}

const ids = new Map();
const declare = (id, n) => {
  if (ids.has(id)) fail(n, `${id} is already used on line ${ids.get(id)}`);
  else ids.set(id, n);
};

const constraints = find("Constraints");
if (constraints) {
  let prefix = null;
  const seen = new Set();
  for (const { n, text } of constraints.lines) {
    const h3 = /^### (.+?)\s*$/.exec(text);
    if (h3) {
      const kind = KINDS.find(([name]) => name === h3[1]);
      if (!kind) fail(n, `unknown constraint kind "${h3[1]}"`);
      prefix = kind?.[1] ?? null;
      if (kind) seen.add(kind[0]);
      continue;
    }
    const item = /^- (.*)$/.exec(text)?.[1];
    if (item === undefined || item === NONE) continue;
    const m = /^([BSD]\d+): \S/.exec(item);
    if (!m) fail(n, 'constraint is not "<id>: <text>"');
    else if (prefix === null) fail(n, `${m[1]} is outside a "###" kind`);
    else if (m[1][0] !== prefix) fail(n, `${m[1]} is under the wrong kind`);
    else if (isParent && prefix === "B") {
      fail(n, `${m[1]}: a behaviour constraint belongs to the child that implements it`);
    } else declare(m[1], n);
  }
  for (const [name] of KINDS) {
    if (!seen.has(name)) fail(constraints.n, `missing "### ${name}"`);
  }
}

const received = new Set();
const cases = find("Cases");
if (cases) {
  for (const { n, item } of bullets(cases.lines)) {
    if (item === NONE) continue;
    const m = /^(C\d+) \[([^\]]*)\]: \S/.exec(item);
    if (!m) {
      fail(n, 'case is not "C<n> [B<n>, ...]: <text>"');
      continue;
    }
    declare(m[1], n);
    const refs = m[2].split(",").map((r) => r.trim()).filter(Boolean);
    if (refs.length === 0) fail(n, `${m[1]} receives no constraint`);
    for (const ref of refs) {
      if (!/^B\d+$/.test(ref)) fail(n, `${m[1]} receives ${ref}: only B ids are received by cases`);
      else if (!ids.has(ref)) fail(n, `${m[1]} receives ${ref}, which is not declared`);
      else received.add(ref);
    }
  }
}

for (const [id, n] of ids) {
  if (id.startsWith("B") && !received.has(id)) fail(n, `${id} is received by no case`);
}

const hasBehaviourConstraints = [...ids.keys()].some((id) => id.startsWith("B"));
const checks = find("Verification");
if (checks) {
  const items = bullets(checks.lines);
  const isBareNone = items.length === 1 && items[0].item === NONE;

  for (const { n, item } of items) {
    if (item === NONE || /^None: \S/.test(item)) {
      if (items.length > 1) {
        fail(n, '"None" must be the only item in "Verification"');
      }
      continue;
    }
    const m = /^V(\d+)(?: \[([^\]]*)\])?: (\S.*)$/.exec(item);
    if (!m) {
      fail(n, 'check is not "V<n>: <entry> ..." or "None: <reason>"');
      continue;
    }
    const vId = `V${m[1]}`;
    const refs = m[2]
      ?.split(",")
      .map((r) => r.trim())
      .filter(Boolean);
    if (!/`[^`]+`/.test(m[3])) fail(n, `${vId} names no entry in backticks`);
    for (const ref of refs ?? []) {
      if (!/^B\d+$/.test(ref)) fail(n, `${vId} names ${ref}: only B ids are named by checks`);
      else if (!ids.has(ref)) fail(n, `${vId} names ${ref}, which is not declared`);
    }
    declare(vId, n);
  }

  if (!hasBehaviourConstraints) {
    if (!isBareNone) {
      fail(checks.n, '"Verification" must be "- None" when there are no behaviour constraints');
    }
  } else if (isBareNone || items.length === 0) {
    fail(
      checks.n,
      '"Verification" needs "V<n>" items or "None: <reason>" when there are behaviour constraints',
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${file}: ok`);
