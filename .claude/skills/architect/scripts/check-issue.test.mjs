import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL("./check-issue.mjs", import.meta.url));

const BASE_CHILD = `## 背景

テスト用の背景です。

## 設計

テスト用の設計です。

## 対応内容

- テスト用の対応内容です。

## 制約

### 振る舞い
- B1: テスト用の振る舞いです。

### 構造
- なし

### 向き
- なし

## ケース
- C1 [B1]: テスト用のケースです。

## 実物での確認
- V1 [B1]: \`runs/example.ts\` を走らせます。「ok」と出れば合格です。

## To Implementer
- Files / modules: なし
`;

const PARENT_WITHOUT_CONFIRMED = `## 決定

テスト用の決定です。

## 変わる振る舞い
- なし

## 全体の中の位置

テスト用の位置です。

## 理由
- 原則 1: テスト用の理由です。

## 見送った形
- なし

## 手放したもの
- なし
`;

function tempFile(name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "check-issue-"));
  const file = path.join(dir, name);
  fs.writeFileSync(file, body);
  return file;
}

async function runCheck(body, name = "body.md") {
  const file = tempFile(name, body);
  try {
    const result = await execFileAsync(process.execPath, [SCRIPT, file]);
    return { code: 0, stdout: result.stdout, stderr: result.stderr, file };
  } catch (err) {
    return { code: err.code, stdout: err.stdout, stderr: err.stderr, file };
  }
}

test("reports a missing confirmation section and exits 1", async () => {
  const body = BASE_CHILD.replace(
    /## 実物での確認\n[\s\S]*?\n\n## To Implementer/,
    "## To Implementer",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /missing section "## 実物での確認"/);
});

test("reports a confirmation section placed before the cases and exits 1", async () => {
  const confirmationBlock = `## 実物での確認
- V1 [B1]: \`runs/example.ts\` を走らせます。「ok」と出れば合格です。

`;
  const body = BASE_CHILD.replace(
    /## 実物での確認\n[\s\S]*?\n\n(?=## To Implementer)/,
    "",
  ).replace("## ケース", `${confirmationBlock}## ケース`);

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /"## 実物での確認" is out of order/);
});

test("reports a decision record missing the confirmed-facts section and exits 1", async () => {
  const { code, stderr } = await runCheck(PARENT_WITHOUT_CONFIRMED);

  assert.equal(code, 1);
  assert.match(stderr, /missing section "## 確かめたこと"/);
});

test("reports a bare confirmation entry as wrong when there are no behaviour constraints, and exits 1", async () => {
  const body = BASE_CHILD.replace("- B1: テスト用の振る舞いです。", "- なし")
    .replace("- C1 [B1]: テスト用のケースです。", "- なし")
    .replace(
      "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。",
      "- なし: 入口がありません",
    );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(
    stderr,
    /"実物での確認" must be "- なし" when there are no behaviour constraints/,
  );
});

test("reports a bare confirmation entry as wrong when there are behaviour constraints, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。",
    "- なし",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(
    stderr,
    /"実物での確認" needs "V<n>" items or "なし: <reason>" when there are behaviour constraints/,
  );
});

test("reports a confirmation entry with the wrong shape and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。",
    "- runs/example.ts を走らせます",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /check is not "V<n>: <entry> \.\.\." or "なし: <reason>"/);
});

test("reports a confirmation entry naming an undeclared behaviour constraint, and exits 1", async () => {
  const body = BASE_CHILD.replace("V1 [B1]:", "V1 [B9]:");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names B9, which is not declared/);
});

test("reports a confirmation entry naming a case instead of a behaviour constraint, and exits 1", async () => {
  const body = BASE_CHILD.replace("V1 [B1]:", "V1 [C1]:");

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names C1: only B ids are named by checks/);
});

test("reports a confirmation entry with no entry in backticks, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "`runs/example.ts` を走らせます",
    "runs/example.ts を走らせます",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 names no entry in backticks/);
});

test("reports a repeated confirmation id, naming the line it was already used on, and exits 1", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。\n",
    "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。\n- V1 [B1]: `runs/example.ts` をもう一度走らせます。\n",
  );

  const { code, stderr } = await runCheck(body);

  assert.equal(code, 1);
  assert.match(stderr, /V1 is already used on line/);
});

test("prints ok and exits 0 for a body with every section in place", async () => {
  const { code, stdout, file } = await runCheck(BASE_CHILD);

  assert.equal(code, 0);
  assert.equal(stdout, `${file}: ok\n`);
});

test("prints ok and exits 0 when the confirmation entry gives a reason instead of an entry", async () => {
  const body = BASE_CHILD.replace(
    "- V1 [B1]: `runs/example.ts` を走らせます。「ok」と出れば合格です。",
    "- なし: 走らせる入口がありません。#12 で確かめます",
  );

  const { code, stdout, file } = await runCheck(body);

  assert.equal(code, 0);
  assert.equal(stdout, `${file}: ok\n`);
});
