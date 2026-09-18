import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { afterAll, describe, expect, expectTypeOf, test } from "vitest";
import { FileToolError } from "./errors.js";
import { createReadFileTool } from "./read.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-files-read-"));
const root = realpathSync(dir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, content: string): Promise<void> =>
  writeFile(join(root, name), content);

const readFile = createReadFileTool({ root });

describe("createReadFileTool", () => {
  test("is a Tool named read_file", () => {
    expectTypeOf(readFile).toExtend<Tool>();
    expect(readFile.name).toBe("read_file");
  });

  test("reads the whole file with line numbers and a tab", async () => {
    await write("whole.txt", "one\ntwo\nthree");

    await expect(
      readFile.execute({ path: "whole.txt" }, {}),
    ).resolves.toBe("1\tone\n2\ttwo\n3\tthree");
  });

  test("a trailing newline does not add an extra line", async () => {
    await write("trailing.txt", "one\ntwo\n");

    await expect(
      readFile.execute({ path: "trailing.txt" }, {}),
    ).resolves.toBe("1\tone\n2\ttwo");
  });

  test("a line range returns only those lines", async () => {
    await write("range.txt", "one\ntwo\nthree\nfour");

    await expect(
      readFile.execute(
        {
          path: "range.txt",
          range: { start: { line: 2 }, end: { line: 3 } },
        },
        {},
      ),
    ).resolves.toBe("2\ttwo\n3\tthree");
  });

  test("a start-only range reads to the end of the file", async () => {
    await write("tail.txt", "one\ntwo\nthree\nfour");

    await expect(
      readFile.execute(
        { path: "tail.txt", range: { start: { line: 3 } } },
        {},
      ),
    ).resolves.toBe("3\tthree\n4\tfour");
  });

  test("a col range cuts the first and last lines at code points", async () => {
    await write("cols.txt", "abcdef\nghijkl\nmnopqr");

    await expect(
      readFile.execute(
        {
          path: "cols.txt",
          range: {
            start: { line: 1, col: 3 },
            end: { line: 3, col: 3 },
          },
        },
        {},
      ),
    ).resolves.toBe("1\tcdef\n2\tghijkl\n3\tmn");
  });

  test("a multi-byte character counts as one code point", async () => {
    await write("emoji.txt", "a😀bcd");

    await expect(
      readFile.execute(
        {
          path: "emoji.txt",
          range: {
            start: { line: 1, col: 2 },
            end: { line: 1, col: 3 },
          },
        },
        {},
      ),
    ).resolves.toBe("1\t😀");
  });

  test("end.col is exclusive", async () => {
    await write("exclusive.txt", "abcdef");

    await expect(
      readFile.execute(
        {
          path: "exclusive.txt",
          range: {
            start: { line: 1, col: 1 },
            end: { line: 1, col: 4 },
          },
        },
        {},
      ),
    ).resolves.toBe("1\tabc");
  });

  test("a col beyond the line length yields empty text, not an error", async () => {
    await write("short.txt", "ab");

    await expect(
      readFile.execute(
        { path: "short.txt", range: { start: { line: 1, col: 10 } } },
        {},
      ),
    ).resolves.toBe("1\t");
  });

  test("rejects a line beyond the end of the file", async () => {
    await write("oneline.txt", "only");

    await expect(
      readFile.execute(
        { path: "oneline.txt", range: { start: { line: 5 } } },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects an end line before the start line", async () => {
    await write("reversed.txt", "a\nb\nc");

    await expect(
      readFile.execute(
        {
          path: "reversed.txt",
          range: { start: { line: 3 }, end: { line: 1 } },
        },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a directory", async () => {
    await mkdir(join(root, "adir"), { recursive: true });

    await expect(
      readFile.execute({ path: "adir" }, {}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a missing file", async () => {
    await expect(
      readFile.execute({ path: "nope.txt" }, {}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects binary content", async () => {
    await write("bin.dat", "abc\0def");

    await expect(
      readFile.execute({ path: "bin.dat" }, {}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("truncates output at maxOutputChars and marks it", async () => {
    const small = createReadFileTool({ root, maxOutputChars: 5 });
    await write("big.txt", "0123456789");

    await expect(small.execute({ path: "big.txt" }, {})).resolves.toBe(
      "1\t012\n[output truncated]",
    );
  });

  test("returns a placeholder for an empty file", async () => {
    await write("empty.txt", "");

    await expect(
      readFile.execute({ path: "empty.txt" }, {}),
    ).resolves.toBe("(empty file)");
  });

  test("rejects immediately when the signal is already aborted", async () => {
    await write("aborted.txt", "content");
    const controller = new AbortController();
    controller.abort();

    await expect(
      readFile.execute(
        { path: "aborted.txt" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
