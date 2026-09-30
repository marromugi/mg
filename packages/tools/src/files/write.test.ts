import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { afterAll, describe, expect, expectTypeOf, test } from "vitest";
import { FileToolError } from "./errors.js";
import { createWriteFileTool } from "./write.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-files-write-"));
const root = realpathSync(dir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const writeFile = createWriteFileTool({ root });

describe("createWriteFileTool", () => {
  test("is a Tool named write_file", () => {
    expectTypeOf(writeFile).toExtend<Tool>();
    expect(writeFile.name).toBe("write_file");
  });

  test("creates a new file", async () => {
    await expect(
      (
        await writeFile.prepare({
          path: "new.txt",
          content: "one\ntwo",
        })
      ).run({}),
    ).resolves.toBe("Wrote new.txt (2 lines).");

    expect(readFileSync(join(root, "new.txt"), "utf8")).toBe(
      "one\ntwo",
    );
  });

  test("creates missing parent directories", async () => {
    await expect(
      (
        await writeFile.prepare({
          path: "nested/dir/new.txt",
          content: "hi",
        })
      ).run({}),
    ).resolves.toBe("Wrote nested/dir/new.txt (1 lines).");

    expect(
      readFileSync(join(root, "nested", "dir", "new.txt"), "utf8"),
    ).toBe("hi");
  });

  test("overwrites an existing file completely", async () => {
    await (
      await writeFile.prepare({
        path: "existing.txt",
        content: "old content\nmore old",
      })
    ).run({});

    await expect(
      (
        await writeFile.prepare({
          path: "existing.txt",
          content: "new",
        })
      ).run({}),
    ).resolves.toBe("Wrote existing.txt (1 lines).");

    expect(readFileSync(join(root, "existing.txt"), "utf8")).toBe(
      "new",
    );
  });

  test("empty content reports 0 lines", async () => {
    await expect(
      (await writeFile.prepare({ path: "empty.txt", content: "" })).run(
        {},
      ),
    ).resolves.toBe("Wrote empty.txt (0 lines).");

    expect(readFileSync(join(root, "empty.txt"), "utf8")).toBe("");
  });

  test("rejects a path outside the root and writes nothing", async () => {
    await expect(
      (
        await writeFile.prepare({
          path: "../outside.txt",
          content: "nope",
        })
      ).run({}),
    ).rejects.toBeInstanceOf(FileToolError);

    const outsidePath = join(root, "..", "outside.txt");
    expect(() => readFileSync(outsidePath, "utf8")).toThrow();
  });

  test("rejects when the target is a directory", async () => {
    await mkdir(join(root, "adir"), { recursive: true });

    await expect(
      (await writeFile.prepare({ path: "adir", content: "nope" })).run(
        {},
      ),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a FIFO", async () => {
    const fifoPath = join(root, "pipe.fifo");
    try {
      execFileSync("mkfifo", [fifoPath]);
    } catch {
      return;
    }

    await expect(
      (
        await writeFile.prepare({ path: "pipe.fifo", content: "nope" })
      ).run({}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      (
        await writeFile.prepare({
          path: "aborted.txt",
          content: "content",
        })
      ).run({ signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });

    expect(() =>
      readFileSync(join(root, "aborted.txt"), "utf8"),
    ).toThrow();
  });
});
