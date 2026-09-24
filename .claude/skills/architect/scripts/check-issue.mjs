#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const CHILD_H2 = [
  "背景",
  "設計",
  "対応内容",
  "制約",
  "ケース",
  "実物での確認",
  "To Implementer",
];
const RECORD_H2 = [
  "決定",
  "変わる振る舞い",
  "全体の中の位置",
  "確かめたこと",
  "理由",
  "見送った形",
  "手放したもの",
];
const KINDS = [
  ["振る舞い", "B"],
  ["構造", "S"],
  ["向き", "D"],
];
const NONE = "なし";

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
const hasRecord = Boolean(find("決定"));
const isParent = hasRecord && !isChild;

if (!isChild && !hasRecord) {
  fail(1, 'neither "## To Implementer" nor "## 決定": not an architect issue');
}
if (isChild) requireInOrder(CHILD_H2);
if (hasRecord) requireInOrder(RECORD_H2);
if (isParent && !find("子 issue")) fail(1, 'missing section "## 子 issue"');

for (const title of ["理由", "見送った形"]) {
  for (const { n, item } of bullets(find(title)?.lines ?? [])) {
    if (item !== NONE && !/原則 ?\d/.test(item)) {
      fail(n, `"${title}" item cites no principle`);
    }
  }
}

const ids = new Map();
const declare = (id, n) => {
  if (ids.has(id)) fail(n, `${id} is already used on line ${ids.get(id)}`);
  else ids.set(id, n);
};

const constraints = find("制約");
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
const cases = find("ケース");
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
const checks = find("実物での確認");
if (checks) {
  const items = bullets(checks.lines);
  const isBareNone = items.length === 1 && items[0].item === NONE;

  for (const { n, item } of items) {
    if (item === NONE || /^なし: \S/.test(item)) {
      if (items.length > 1) {
        fail(n, '"なし" must be the only item in "実物での確認"');
      }
      continue;
    }
    const m = /^V(\d+)(?: \[([^\]]*)\])?: (\S.*)$/.exec(item);
    if (!m) {
      fail(n, 'check is not "V<n>: <entry> ..." or "なし: <reason>"');
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
      fail(checks.n, '"実物での確認" must be "- なし" when there are no behaviour constraints');
    }
  } else if (isBareNone || items.length === 0) {
    fail(
      checks.n,
      '"実物での確認" needs "V<n>" items or "なし: <reason>" when there are behaviour constraints',
    );
  }
}

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${file}: ok`);
