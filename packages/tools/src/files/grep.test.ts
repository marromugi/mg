import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Tool } from "@mg/core";
import { afterAll, describe, expect, expectTypeOf, test } from "vitest";
import { FileToolError } from "./errors.js";
import { createGrepTool } from "./grep.js";

const hasRg = spawnSync("rg", ["--version"]).status === 0;

const dir = mkdtempSync(join(tmpdir(), "mg-tools-files-grep-"));
const root = realpathSync(dir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const write = (name: string, content: string): void => {
  writeFileSync(join(root, name), content);
};

if (hasRg) {
  execFileSync("git", ["init"], { cwd: root });
  mkdirSync(join(root, "sub"), { recursive: true });
  write(".gitignore", "ignored.txt\n");
  write("a.txt", "hello world\nfoo bar\n");
  write("ignored.txt", "hello ignored\n");
  write("sub/b.txt", "préfix hello\nhello hello\n");
  write("case.txt", "HELLO\n");
  write("long.txt", `${"x".repeat(400)}hello\n`);
  write(
    "many.txt",
    `${Array.from({ length: 10 }, () => "hello").join("\n")}\n`,
  );
}

describe.skipIf(!hasRg)("createGrepTool", () => {
  const grep = createGrepTool({ root });

  test("is a Tool named grep", () => {
    expectTypeOf(grep).toExtend<Tool>();
    expect(grep.name).toBe("grep");
  });

  test("finds matches across files as path:line:col: text with / separators", async () => {
    const result = await grep.execute({ pattern: "hello" }, {});
    expect(result).toContain("a.txt:1:1: hello world");
    expect(result).toContain("sub/b.txt:1:8: préfix hello");
  });

  test("column counts code points, not bytes, after a multi-byte character", async () => {
    const result = await grep.execute(
      { pattern: "hello", path: "sub/b.txt" },
      {},
    );
    expect(result.split("\n")[0]).toBe("sub/b.txt:1:8: préfix hello");
  });

  test("two matches on one line yield two lines", async () => {
    const result = await grep.execute(
      { pattern: "hello", path: "sub/b.txt" },
      {},
    );
    const secondLineMatches = result
      .split("\n")
      .filter((line) => line.startsWith("sub/b.txt:2:"));
    expect(secondLineMatches).toEqual([
      "sub/b.txt:2:1: hello hello",
      "sub/b.txt:2:7: hello hello",
    ]);
  });

  test("glob restricts which files are searched", async () => {
    const result = await grep.execute(
      { pattern: "hello", glob: "a.*" },
      {},
    );
    expect(result).toBe("a.txt:1:1: hello world");
  });

  test("ignoreCase widens matches", async () => {
    const caseSensitive = await grep.execute(
      { pattern: "hello", path: "case.txt" },
      {},
    );
    expect(caseSensitive).toMatch(/^No matches/);

    const caseInsensitive = await grep.execute(
      { pattern: "hello", path: "case.txt", ignoreCase: true },
      {},
    );
    expect(caseInsensitive).toBe("case.txt:1:1: HELLO");
  });

  test("path narrows the search to a subdirectory", async () => {
    const result = await grep.execute(
      { pattern: "hello", path: "sub" },
      {},
    );
    expect(result).toContain("sub/b.txt");
    expect(result).not.toContain("a.txt:");
  });

  test("a file ignored per .gitignore is not searched", async () => {
    const result = await grep.execute({ pattern: "hello" }, {});
    expect(result).not.toContain("ignored.txt");
  });

  test("no match returns a sentence instead of throwing", async () => {
    await expect(
      grep.execute({ pattern: "zzzznotfound" }, {}),
    ).resolves.toBe("No matches for /zzzznotfound/ in ..");

    await expect(
      grep.execute({ pattern: "zzzznotfound", path: "sub" }, {}),
    ).resolves.toBe("No matches for /zzzznotfound/ in sub.");
  });

  test("maxResults truncation appends a marker", async () => {
    const small = createGrepTool({ root, maxResults: 3 });
    const result = await small.execute(
      { pattern: "hello", path: "many.txt" },
      {},
    );
    const lines = result.split("\n");
    expect(lines).toEqual([
      "many.txt:1:1: hello",
      "many.txt:2:1: hello",
      "many.txt:3:1: hello",
      "[results truncated]",
    ]);
  });

  test("maxLineChars cuts long lines", async () => {
    const small = createGrepTool({ root, maxLineChars: 10 });
    const result = await small.execute(
      { pattern: "hello", path: "long.txt" },
      {},
    );
    expect(result).toBe(`long.txt:1:401: ${"x".repeat(10)}…`);
  });

  test("an invalid regex rejects with FileToolError", async () => {
    await expect(
      grep.execute({ pattern: "(" }, {}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("an rgPath pointing to a missing binary rejects with the not-installed message", async () => {
    const missing = createGrepTool({
      root,
      rgPath: "/nonexistent/rg-binary",
    });
    await expect(
      missing.execute({ pattern: "hello" }, {}),
    ).rejects.toMatchObject({
      name: "FileToolError",
      message: "ripgrep (rg) is not installed or not on PATH",
    });
  });

  test("a path outside the root rejects with FileToolError", async () => {
    await expect(
      grep.execute({ pattern: "hello", path: "../outside" }, {}),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("an already aborted signal rejects without spawning", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      grep.execute({ pattern: "hello" }, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("column conversion", () => {
  test("counts code points up to the byte offset, not bytes", () => {
    const lineText = "préfix hello\n";
    const byteStart = Buffer.from(lineText, "utf8").indexOf(
      Buffer.from("hello", "utf8"),
    );

    const col =
      Array.from(
        Buffer.from(lineText, "utf8")
          .subarray(0, byteStart)
          .toString("utf8"),
      ).length + 1;

    expect(col).toBe(8);
  });
});
