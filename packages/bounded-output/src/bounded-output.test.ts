import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { closingLine, createBoundedOutput } from "./index.js";

const dir = mkdtempSync(join(tmpdir(), "mg-bounded-output-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("createBoundedOutput keeping the end", () => {
  test("keeps output at the limit whole and writes no file", async () => {
    const saved = join(dir, "small");
    const output = createBoundedOutput({
      maxBytes: 8,
      dir: saved,
      maxSavedBytes: 100,
      keep: "end",
      onStop: () => {},
    });
    output.append(Buffer.from("abc\n"));
    output.append(Buffer.from("def\n"));
    await expect(output.finish()).resolves.toEqual({
      text: "abc\ndef",
      keep: "end",
      totalBytes: 8,
      totalLines: 2,
      shownLines: { from: 1, to: 2 },
      partialLine: false,
      partialLineBytes: 0,
      savedCapReached: false,
    });
    expect(readdirSync(dir)).not.toContain("small");
  });

  test("starts the kept end at a whole line and saves every byte", async () => {
    const output = createBoundedOutput({
      maxBytes: 8,
      dir,
      maxSavedBytes: 100,
      keep: "end",
      onStop: () => {},
    });
    for (const line of ["one\n", "two\n", "three\n", "four\n"]) {
      output.append(Buffer.from(line));
    }
    const result = await output.finish();
    expect(result).toMatchObject({
      text: "four",
      totalBytes: 19,
      totalLines: 4,
      shownLines: { from: 4, to: 4 },
      partialLine: false,
    });
    expect(readFileSync(result.savedPath ?? "", "utf8")).toBe(
      "one\ntwo\nthree\nfour\n",
    );
    expect(closingLine(result)).toBe(
      `[showing lines 4-4 of 4 (4 B of 19 B). Full output: ${result.savedPath}]`,
    );
  });

  test("cuts a long last line at a character boundary", async () => {
    const output = createBoundedOutput({
      maxBytes: 7,
      dir,
      maxSavedBytes: 100,
      keep: "end",
      onStop: () => {},
    });
    const bytes = Buffer.from("あいうえお");
    output.append(bytes.subarray(0, 4));
    output.append(bytes.subarray(4));
    const result = await output.finish();
    expect(result).toMatchObject({
      text: "えお",
      totalBytes: 15,
      partialLine: true,
      partialLineBytes: 15,
    });
    expect(closingLine(result)).toBe(
      `[showing the last 6 B of line 1 (line is 15 B; 15 B in all). Full output: ${result.savedPath}]`,
    );
  });

  test("signals the stop when the saved cap is passed and keeps the first bytes", async () => {
    let stops = 0;
    const output = createBoundedOutput({
      maxBytes: 4,
      dir,
      maxSavedBytes: 10,
      keep: "end",
      onStop: () => stops++,
    });
    output.append(Buffer.from("0123456789abcdef"));
    const result = await output.finish();
    expect(stops).toBe(1);
    expect(result.savedCapReached).toBe(true);
    expect(readFileSync(result.savedPath ?? "", "utf8")).toBe(
      "0123456789",
    );
  });
});

describe("createBoundedOutput keeping the start", () => {
  test("keeps output at the limit whole and writes no file", async () => {
    const output = createBoundedOutput({
      maxBytes: 8,
      dir: join(dir, "small-start"),
      maxSavedBytes: 100,
      keep: "start",
      onStop: () => {},
    });
    output.append(Buffer.from("abc\ndef\n"));
    const result = await output.finish();
    expect(result).toEqual({
      text: "abc\ndef",
      keep: "start",
      totalBytes: 8,
      totalLines: 2,
      shownLines: { from: 1, to: 2 },
      partialLine: false,
      partialLineBytes: 0,
      savedCapReached: false,
    });
    expect(closingLine(result)).toBeUndefined();
    expect(readdirSync(dir)).not.toContain("small-start");
  });

  test("ends the kept start at the end of a line and saves every byte", async () => {
    const output = createBoundedOutput({
      maxBytes: 10,
      dir,
      maxSavedBytes: 100,
      keep: "start",
      onStop: () => {},
    });
    for (const line of ["one\n", "two\n", "three\n", "four\n"]) {
      output.append(Buffer.from(line));
    }
    const result = await output.finish();
    expect(result).toMatchObject({
      text: "one\ntwo",
      totalBytes: 19,
      totalLines: 4,
      shownLines: { from: 1, to: 2 },
      partialLine: false,
    });
    expect(readFileSync(result.savedPath ?? "", "utf8")).toBe(
      "one\ntwo\nthree\nfour\n",
    );
    expect(closingLine(result)).toBe(
      `[showing lines 1-2 of 4 (7 B of 19 B). Full output: ${result.savedPath}]`,
    );
  });

  test("keeps a line that ends exactly at the limit", async () => {
    const output = createBoundedOutput({
      maxBytes: 7,
      dir,
      maxSavedBytes: 100,
      keep: "start",
      onStop: () => {},
    });
    output.append(Buffer.from("one\ntwo\nthree\n"));
    await expect(output.finish()).resolves.toMatchObject({
      text: "one\ntwo",
      shownLines: { from: 1, to: 2 },
    });
  });

  test("cuts a long first line at a character boundary", async () => {
    const output = createBoundedOutput({
      maxBytes: 7,
      dir,
      maxSavedBytes: 100,
      keep: "start",
      onStop: () => {},
    });
    const bytes = Buffer.from("あいうえお\nnext\n");
    output.append(bytes.subarray(0, 4));
    output.append(bytes.subarray(4));
    const result = await output.finish();
    expect(result).toMatchObject({
      text: "あい",
      totalBytes: 21,
      partialLine: true,
      partialLineBytes: 15,
    });
    expect(closingLine(result)).toBe(
      `[showing the first 6 B of line 1 (line is 15 B; 21 B in all). Full output: ${result.savedPath}]`,
    );
  });

  test("signals the stop when the saved cap is passed and keeps the first bytes", async () => {
    let stops = 0;
    const output = createBoundedOutput({
      maxBytes: 4,
      dir,
      maxSavedBytes: 10,
      keep: "start",
      onStop: () => stops++,
    });
    output.append(Buffer.from("0123456789abcdef"));
    const result = await output.finish();
    expect(stops).toBe(1);
    expect(result).toMatchObject({
      text: "0123",
      savedCapReached: true,
    });
    expect(readFileSync(result.savedPath ?? "", "utf8")).toBe(
      "0123456789",
    );
  });
});
