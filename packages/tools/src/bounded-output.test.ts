import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { createBoundedOutput } from "./bounded-output.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-bounded-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("createBoundedOutput", () => {
  test("keeps output at the limit whole and writes no file", async () => {
    const saved = join(dir, "small");
    const output = createBoundedOutput({
      maxBytes: 8,
      dir: saved,
      maxSavedBytes: 100,
      onStop: () => {},
    });
    output.append(Buffer.from("abc\n"));
    output.append(Buffer.from("def\n"));
    await expect(output.finish()).resolves.toEqual({
      text: "abc\ndef",
      totalBytes: 8,
      totalLines: 2,
      shownFromLine: 1,
      lastLinePartial: false,
      lastLineBytes: 3,
      savedCapReached: false,
    });
    expect(readdirSync(dir)).not.toContain("small");
  });

  test("starts the kept end at a whole line and saves every byte", async () => {
    const output = createBoundedOutput({
      maxBytes: 8,
      dir,
      maxSavedBytes: 100,
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
      shownFromLine: 4,
      lastLinePartial: false,
    });
    expect(readFileSync(result.savedPath ?? "", "utf8")).toBe(
      "one\ntwo\nthree\nfour\n",
    );
  });

  test("cuts a long last line at a character boundary", async () => {
    const output = createBoundedOutput({
      maxBytes: 7,
      dir,
      maxSavedBytes: 100,
      onStop: () => {},
    });
    const bytes = Buffer.from("あいうえお");
    output.append(bytes.subarray(0, 4));
    output.append(bytes.subarray(4));
    const result = await output.finish();
    expect(result).toMatchObject({
      text: "えお",
      totalBytes: 15,
      lastLinePartial: true,
      lastLineBytes: 15,
    });
  });

  test("signals the stop when the saved cap is passed and keeps the first bytes", async () => {
    let stops = 0;
    const output = createBoundedOutput({
      maxBytes: 4,
      dir,
      maxSavedBytes: 10,
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
