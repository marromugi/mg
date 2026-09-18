import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { afterAll, describe, expect, expectTypeOf, test } from "vitest";
import { createEditFileTool } from "./edit.js";
import { FileToolError } from "./errors.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-files-edit-"));
const root = realpathSync(dir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, content: string): Promise<void> =>
  writeFile(join(root, name), content);

const read = (name: string): string =>
  readFileSync(join(root, name), "utf8");

const editFile = createEditFileTool({ root });

describe("createEditFileTool", () => {
  test("is a Tool named edit_file", () => {
    expectTypeOf(editFile).toExtend<Tool>();
    expect(editFile.name).toBe("edit_file");
  });

  test("replaces a single match and reports its line", async () => {
    await write("single.txt", "one\ntwo\nthree");

    await expect(
      editFile.execute(
        { path: "single.txt", oldString: "two", newString: "TWO" },
        {},
      ),
    ).resolves.toBe("Replaced 1 occurrence in single.txt (line 2).");

    expect(read("single.txt")).toBe("one\nTWO\nthree");
  });

  test("leaves the rest of the file untouched", async () => {
    await write("rest.txt", "alpha\nbeta\ngamma\ndelta");

    await editFile.execute(
      { path: "rest.txt", oldString: "gamma", newString: "GAMMA" },
      {},
    );

    expect(read("rest.txt")).toBe("alpha\nbeta\nGAMMA\ndelta");
  });

  test("replaces a multi-line oldString", async () => {
    await write("multi.txt", "one\ntwo\nthree\nfour");

    await expect(
      editFile.execute(
        {
          path: "multi.txt",
          oldString: "two\nthree",
          newString: "TWO\nTHREE",
        },
        {},
      ),
    ).resolves.toBe("Replaced 1 occurrence in multi.txt (line 2).");

    expect(read("multi.txt")).toBe("one\nTWO\nTHREE\nfour");
  });

  test("rejects when oldString is not found and leaves the file unchanged", async () => {
    await write("missing.txt", "one\ntwo\nthree");

    await expect(
      editFile.execute(
        { path: "missing.txt", oldString: "nope", newString: "NOPE" },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);

    expect(read("missing.txt")).toBe("one\ntwo\nthree");
  });

  test("rejects two matches without replaceAll, naming the count and lines", async () => {
    await write("dupe.txt", "dup\nx\ndup\ny\nz");

    const error: unknown = await editFile
      .execute(
        { path: "dupe.txt", oldString: "dup", newString: "DUP" },
        {},
      )
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(FileToolError);
    expect((error as Error).message).toContain("2 times");
    expect((error as Error).message).toContain("1");
    expect((error as Error).message).toContain("3");
    expect(read("dupe.txt")).toBe("dup\nx\ndup\ny\nz");
  });

  test("replaceAll replaces every match and reports the count and lines", async () => {
    await write("all.txt", "dup\nx\ndup\ny\ndup");

    await expect(
      editFile.execute(
        {
          path: "all.txt",
          oldString: "dup",
          newString: "DUP",
          replaceAll: true,
        },
        {},
      ),
    ).resolves.toBe(
      "Replaced 3 occurrences in all.txt (lines 1, 3, 5).",
    );

    expect(read("all.txt")).toBe("DUP\nx\nDUP\ny\nDUP");
  });

  test("inserts newString containing $& literally", async () => {
    await write("dollar.txt", "one\ntwo\nthree");

    await editFile.execute(
      { path: "dollar.txt", oldString: "two", newString: "$&$&" },
      {},
    );

    expect(read("dollar.txt")).toBe("one\n$&$&\nthree");
  });

  test("rejects identical oldString and newString", async () => {
    await write("same.txt", "one\ntwo\nthree");

    await expect(
      editFile.execute(
        { path: "same.txt", oldString: "two", newString: "two" },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);

    expect(read("same.txt")).toBe("one\ntwo\nthree");
  });

  test("keeps CRLF line endings after an edit", async () => {
    await write("crlf.txt", "one\r\ntwo\r\nthree");

    await editFile.execute(
      { path: "crlf.txt", oldString: "two", newString: "TWO" },
      {},
    );

    expect(read("crlf.txt")).toBe("one\r\nTWO\r\nthree");
  });

  test("rejects a path outside the root and writes nothing", async () => {
    await write("outside-target.txt", "content");

    await expect(
      editFile.execute(
        {
          path: "../outside-target.txt",
          oldString: "content",
          newString: "changed",
        },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a missing file", async () => {
    await expect(
      editFile.execute(
        { path: "does-not-exist.txt", oldString: "a", newString: "b" },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects when the target is a directory", async () => {
    await mkdir(join(root, "adir"), { recursive: true });

    await expect(
      editFile.execute(
        { path: "adir", oldString: "a", newString: "b" },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a binary file", async () => {
    await write("binary.txt", "one\0two");

    await expect(
      editFile.execute(
        { path: "binary.txt", oldString: "one", newString: "ONE" },
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects immediately when the signal is already aborted", async () => {
    await write("aborted.txt", "one\ntwo\nthree");
    const controller = new AbortController();
    controller.abort();

    await expect(
      editFile.execute(
        { path: "aborted.txt", oldString: "two", newString: "TWO" },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(read("aborted.txt")).toBe("one\ntwo\nthree");
  });
});
