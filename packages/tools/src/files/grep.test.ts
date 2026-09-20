import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
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
import { columnOf, createGrepTool } from "./grep.js";

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
  write("crlf.txt", "hello crlf\r\n");
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

  test("description says hidden files are searched", () => {
    expect(grep.description).toContain("Searches hidden files");
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
    ).resolves.toBe("No matches for /zzzznotfound/ in the root.");

    await expect(
      grep.execute({ pattern: "zzzznotfound", path: "sub" }, {}),
    ).resolves.toBe("No matches for /zzzznotfound/ in sub.");
  });

  test("a trailing CRLF is dropped from the line text", async () => {
    const result = await grep.execute(
      { pattern: "hello", path: "crlf.txt" },
      {},
    );
    expect(result).toBe("crlf.txt:1:1: hello crlf");
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

  test("maxResults of 0 truncates to just the marker", async () => {
    const none = createGrepTool({ root, maxResults: 0 });
    const result = await none.execute(
      { pattern: "hello", path: "many.txt" },
      {},
    );
    expect(result).toBe("[results truncated]");
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

  test("an rgPath pointing to a directory rejects with the underlying error code", async () => {
    const invalid = createGrepTool({ root, rgPath: root });
    await expect(
      invalid.execute({ pattern: "hello" }, {}),
    ).rejects.toMatchObject({
      name: "FileToolError",
      message: "ripgrep failed: EACCES",
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

describe.skipIf(!hasRg)("hidden files", () => {
  const hiddenDir = mkdtempSync(
    join(tmpdir(), "mg-tools-files-grep-hidden-"),
  );
  const hiddenRoot = realpathSync(hiddenDir);
  afterAll(() => rmSync(hiddenDir, { recursive: true, force: true }));

  execFileSync("git", ["init"], { cwd: hiddenRoot });
  mkdirSync(join(hiddenRoot, ".github"), { recursive: true });
  writeFileSync(join(hiddenRoot, ".github/ci.yml"), "hello hidden\n");
  writeFileSync(join(hiddenRoot, ".env.sample"), "TOKEN=abc\n");
  writeFileSync(
    join(hiddenRoot, ".git/mg-note.txt"),
    "needle-in-git\n",
  );
  writeFileSync(join(hiddenRoot, ".gitignore"), ".secret.txt\n");
  writeFileSync(join(hiddenRoot, ".secret.txt"), "needle-secret\n");

  const grep = createGrepTool({ root: hiddenRoot });

  test("a match inside a hidden directory is returned", async () => {
    const result = await grep.execute({ pattern: "hidden" }, {});
    expect(result).toContain(".github/ci.yml:1:7: hello hidden");
  });

  test("a match inside a hidden file at the root is returned", async () => {
    const result = await grep.execute({ pattern: "TOKEN" }, {});
    expect(result).toContain(".env.sample:1:1: TOKEN=abc");
  });

  test("a match inside .git is returned", async () => {
    const result = await grep.execute({ pattern: "needle-in-git" }, {});
    expect(result).toContain(".git/mg-note.txt:1:1: needle-in-git");
  });

  test("a hidden file listed in .gitignore is still not searched", async () => {
    await expect(
      grep.execute({ pattern: "needle-secret" }, {}),
    ).resolves.toBe("No matches for /needle-secret/ in the root.");
  });
});

describe("column conversion", () => {
  test("counts code points up to the byte offset, not bytes", () => {
    // "préfix " is 7 characters but 8 bytes in UTF-8 (é takes 2 bytes),
    // so byte offset 8 is where "hello" starts.
    expect(columnOf("préfix hello\n", 8)).toBe(8);
  });
});

describe.skipIf(!hasRg)(
  "skipped matches: not valid UTF-8 and binary files",
  () => {
    const notesDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-grep-notes-"),
    );
    const notesRoot = realpathSync(notesDir);
    afterAll(() => rmSync(notesDir, { recursive: true, force: true }));

    writeFileSync(
      join(notesRoot, "latin.txt"),
      Buffer.from([
        0x63, 0x61, 0x66, 0xe9, 0x20, 0x6e, 0x65, 0x65, 0x64, 0x6c,
        0x65, 0x2d, 0x6c, 0x0a,
      ]),
    );
    writeFileSync(
      join(notesRoot, "twice.txt"),
      Buffer.concat([
        Buffer.from([0xff]),
        Buffer.from(" needle-m needle-m\n"),
      ]),
    );

    mkdirSync(join(notesRoot, "mix"), { recursive: true });
    writeFileSync(join(notesRoot, "mix/good.txt"), "needle-x ok\n");
    writeFileSync(
      join(notesRoot, "mix/bad.txt"),
      Buffer.concat([Buffer.from([0xff]), Buffer.from(" needle-x\n")]),
    );

    let canCreateRawName = true;
    mkdirSync(join(notesRoot, "rawname"), { recursive: true });
    try {
      writeFileSync(
        Buffer.concat([
          Buffer.from(`${join(notesRoot, "rawname")}/bad`),
          Buffer.from([0xff]),
          Buffer.from("name.txt"),
        ]),
        "needle-n\n",
      );
    } catch {
      canCreateRawName = false;
    }

    const bigBinary = (firstLine: string): Buffer =>
      Buffer.concat([
        Buffer.from(`${firstLine}\n${"x\n".repeat(60_000)}`),
        Buffer.from([0]),
      ]);

    mkdirSync(join(notesRoot, "bin"), { recursive: true });
    writeFileSync(
      join(notesRoot, "bin/big.bin"),
      bigBinary("needle-b first"),
    );

    mkdirSync(join(notesRoot, "cap"), { recursive: true });
    writeFileSync(
      join(notesRoot, "cap/big.bin"),
      bigBinary("needle-k first"),
    );
    writeFileSync(join(notesRoot, "cap/ok.txt"), "needle-k ok\n");

    mkdirSync(join(notesRoot, "cut"), { recursive: true });
    writeFileSync(
      join(notesRoot, "cut/one.txt"),
      "needle-c line\n".repeat(2_000),
    );

    const grep = createGrepTool({ root: notesRoot });

    test("a match on a line that is not valid UTF-8 becomes a skip count", async () => {
      const result = await grep.execute(
        { pattern: "needle-l", path: "latin.txt" },
        {},
      );
      expect(result).toBe("[skipped 1 matches: not valid UTF-8]");
    });

    test("two matches on the same non-UTF-8 line are both counted", async () => {
      const result = await grep.execute(
        { pattern: "needle-m", path: "twice.txt" },
        {},
      );
      expect(result).toBe("[skipped 2 matches: not valid UTF-8]");
    });

    test("a valid match and a non-UTF-8 skip count both come back, match first", async () => {
      const result = await grep.execute(
        { pattern: "needle-x", path: "mix" },
        {},
      );
      expect(result).toBe(
        "mix/good.txt:1:1: needle-x ok\n[skipped 1 matches: not valid UTF-8]",
      );
    });

    test.skipIf(!canCreateRawName)(
      "a match in a file whose name is not valid UTF-8 becomes a skip count",
      async () => {
        const result = await grep.execute(
          { pattern: "needle-n", path: "rawname" },
          {},
        );
        expect(result).toBe("[skipped 1 matches: not valid UTF-8]");
      },
    );

    test("a match in a file ripgrep judges binary becomes a skip count", async () => {
      const result = await grep.execute(
        { pattern: "needle-b", path: "bin" },
        {},
      );
      expect(result).toBe("[skipped 1 matches: binary file]");
    });

    test("a binary skip does not consume the results cap", async () => {
      const capped = createGrepTool({ root: notesRoot, maxResults: 1 });
      const result = await capped.execute(
        { pattern: "needle-k", path: "cap" },
        {},
      );
      expect(result).toBe(
        "cap/ok.txt:1:1: needle-k ok\n[skipped 1 matches: binary file]",
      );
    });

    test("output cut off by the byte cap returns only the truncation marker", async () => {
      const small = createGrepTool({
        root: notesRoot,
        maxOutputBytes: 4096,
      });
      const result = await small.execute(
        { pattern: "needle-c", path: "cut" },
        {},
      );
      expect(result).toBe("[results truncated]");
    });

    test("description says binary files are skipped", () => {
      expect(grep.description).toContain("Skips binary files");
    });
  },
);

describe.skipIf(!hasRg)(
  "skip notes follow a fixed order after matches",
  () => {
    const fakeDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-grep-fake-"),
    );
    const fakeRoot = realpathSync(fakeDir);
    afterAll(() => rmSync(fakeDir, { recursive: true, force: true }));

    const writeFakeRg = (name: string, script: string): string => {
      const scriptPath = join(fakeDir, name);
      writeFileSync(scriptPath, `#!/usr/bin/env node\n${script}`);
      chmodSync(scriptPath, 0o755);
      return scriptPath;
    };

    test("truncation, the UTF-8 note, and the binary note follow the matches in that order", async () => {
      const rgPath = writeFakeRg(
        "fake-rg-order.js",
        `
const lines = [
  {"type":"match","data":{"path":{"text":"order/a.txt"},"line_number":1,"lines":{"text":"needle-o one\\n"},"submatches":[{"start":0,"end":10}]}},
  {"type":"match","data":{"path":{"text":"order/a.txt"},"line_number":2,"lines":{"text":"needle-o two\\n"},"submatches":[{"start":0,"end":10}]}},
  {"type":"end","data":{"path":{"text":"order/a.txt"},"binary_offset":null}},
  {"type":"match","data":{"path":{"text":"order/bad.txt"},"line_number":1,"lines":{"bytes":"//8="},"submatches":[{"start":0,"end":8}]}},
  {"type":"end","data":{"path":{"text":"order/bad.txt"},"binary_offset":null}},
  {"type":"match","data":{"path":{"text":"order/big.bin"},"line_number":1,"lines":{"text":"needle-o first\\n"},"submatches":[{"start":0,"end":8}]}},
  {"type":"end","data":{"path":{"text":"order/big.bin"},"binary_offset":100}},
  {"type":"summary","data":{"elapsed_total":{"secs":0,"nanos":0,"human":"0.000000s"},"stats":{}}}
];
for (const line of lines) process.stdout.write(JSON.stringify(line) + "\\n");
process.exit(0);
`,
      );

      const grep = createGrepTool({
        root: fakeRoot,
        rgPath,
        maxResults: 1,
      });
      const result = await grep.execute({ pattern: "needle-o" }, {});
      expect(result).toBe(
        "order/a.txt:1:1: needle-o one\n" +
          "[results truncated]\n" +
          "[skipped 1 matches: not valid UTF-8]\n" +
          "[skipped 1 matches: binary file]",
      );
    });

    test("matches of a file whose end never arrives are dropped, but earlier notes still return", async () => {
      const rgPath = writeFakeRg(
        "fake-rg-cutnote.js",
        `
const write = (obj) => process.stdout.write(JSON.stringify(obj) + "\\n");
write({"type":"match","data":{"path":{"text":"cutnote/bad.txt"},"line_number":1,"lines":{"bytes":"//8="},"submatches":[{"start":0,"end":1}]}});
write({"type":"end","data":{"path":{"text":"cutnote/bad.txt"},"binary_offset":null}});
write({"type":"match","data":{"path":{"text":"cutnote/big.bin"},"line_number":1,"lines":{"text":"x\\n"},"submatches":[{"start":0,"end":1}]}});
write({"type":"end","data":{"path":{"text":"cutnote/big.bin"},"binary_offset":50}});
for (let i = 0; i < 5000; i++) {
  write({"type":"match","data":{"path":{"text":"cutnote/flood.txt"},"line_number":i + 1,"lines":{"text":"x\\n"},"submatches":[{"start":0,"end":1}]}});
}
process.exit(0);
`,
      );

      const grep = createGrepTool({
        root: fakeRoot,
        rgPath,
        maxOutputBytes: 4096,
      });
      const result = await grep.execute({ pattern: "x" }, {});
      expect(result).toBe(
        "[results truncated]\n" +
          "[skipped 1 matches: not valid UTF-8]\n" +
          "[skipped 1 matches: binary file]",
      );
    });
  },
);
