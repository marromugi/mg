import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createBashTool } from "./bash.js";
import {
  createEditFileTool,
  createGrepTool,
  createReadFileTool,
  createWriteFileTool,
} from "./files/index.js";
import { createWebSearchTool } from "./web-search/index.js";
import type { WebSearchBackend } from "./web-search/index.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-reach-"));
const T = realpathSync(dir);
const real = join(T, "real");
const link = join(T, "link");

beforeAll(() => {
  mkdirSync(real);
  symlinkSync(real, link);
  writeFileSync(join(real, "a.txt"), "a");
  mkdirSync(join(real, "sub"));
  symlinkSync(join(real, "a.txt"), join(real, "to-a"));
  symlinkSync(join(real, "sub"), join(real, "to-sub"));
  symlinkSync("nowhere", join(real, "dead"));
  symlinkSync(join(real, "loop2"), join(real, "loop1"));
  symlinkSync(join(real, "loop1"), join(real, "loop2"));
  mkdirSync(join(real, "locked"));
  writeFileSync(join(real, "locked", "x.txt"), "x");
  chmodSync(join(real, "locked"), 0o000);
});

afterAll(() => {
  chmodSync(join(real, "locked"), 0o700);
  rmSync(dir, { recursive: true, force: true });
});

const paths = (...values: string[]) => ({
  kind: "paths",
  paths: values.map((path) => ({ path, extent: "file" })),
});
const tree = (path: string) => ({
  kind: "paths",
  paths: [{ path, extent: "tree" }],
});
const anyLocal = { kind: "any-local" };

const read = () => createReadFileTool({ root: link });
const write = () => createWriteFileTool({ root: link });
const edit = () => createEditFileTool({ root: link });
const grep = () => createGrepTool({ root: link });

const fileArgs = (path: string) => ({
  read: { path },
  write: { path, content: "x" },
  edit: { path, oldString: "x", newString: "x" },
});

const failingBackend: WebSearchBackend = {
  name: "Failing",
  async search() {
    throw new Error("the backend must not be called");
  },
};

describe("bash reach", () => {
  test("is any-local for every argument", async () => {
    const tool = createBashTool({ cwd: T });

    expect(await tool.reach({ command: "cat .env" })).toEqual(anyLocal);
    expect(await tool.reach({})).toEqual(anyLocal);
    expect(await tool.reach("x")).toEqual(anyLocal);
  });
});

describe("file tools reach", () => {
  test("declares the followed absolute path of an existing file", async () => {
    const expected = paths(join(real, "a.txt"));

    for (const path of ["a.txt", "to-a"]) {
      const args = fileArgs(path);
      expect(await read().reach(args.read)).toEqual(expected);
      expect(await write().reach(args.write)).toEqual(expected);
      expect(await edit().reach(args.edit)).toEqual(expected);
    }
  });

  test("declares the file extent for a directory path", async () => {
    const expected = paths(join(real, "sub"));

    expect(await read().reach({ path: "sub" })).toEqual(expected);
    expect(
      await edit().reach({
        path: "to-sub",
        oldString: "x",
        newString: "x",
      }),
    ).toEqual(expected);
  });

  test("declares the tree extent of the followed directory for grep", async () => {
    const expected = tree(join(real, "sub"));

    expect(await grep().reach({ pattern: "x", path: "sub" })).toEqual(
      expected,
    );
    expect(
      await grep().reach({ pattern: "x", path: "to-sub" }),
    ).toEqual(expected);
  });

  test("declares the followed existing parent plus the remaining names for a missing path", async () => {
    expect(
      await write().reach({ path: "new/b.txt", content: "x" }),
    ).toEqual(paths(join(real, "new", "b.txt")));
    expect(
      await write().reach({ path: "to-sub/c.txt", content: "x" }),
    ).toEqual(paths(join(real, "sub", "c.txt")));
    expect(await read().reach({ path: "missing.txt" })).toEqual(
      paths(join(real, "missing.txt")),
    );
  });

  test("declares the followed absolute path for a path outside the root", async () => {
    expect(await read().reach({ path: "../outside.txt" })).toEqual(
      paths(join(T, "outside.txt")),
    );
  });

  test("is any-local when the path cannot be followed", async () => {
    expect(await read().reach({ path: "dead" })).toEqual(anyLocal);
    expect(await read().reach({ path: "loop1" })).toEqual(anyLocal);
    expect(
      await write().reach({ path: "dead/y.txt", content: "x" }),
    ).toEqual(anyLocal);
  });

  test.skipIf(process.getuid?.() === 0)(
    "is any-local when a directory on the path is not accessible",
    async () => {
      expect(await read().reach({ path: "locked/x.txt" })).toEqual(
        anyLocal,
      );
    },
  );

  test("is any-local when the root does not exist", async () => {
    const tool = createReadFileTool({ root: join(T, "gone") });

    expect(await tool.reach({ path: "a.txt" })).toEqual(anyLocal);
  });

  test("is any-local when the arguments do not fit the input type", async () => {
    expect(await read().reach({})).toEqual(anyLocal);
    expect(await read().reach({ path: 3 })).toEqual(anyLocal);
    expect(await read().reach(null)).toEqual(anyLocal);
    expect(await grep().reach({ path: "sub" })).toEqual(anyLocal);
  });

  test("declares the tree extent of the followed root for grep without a path", async () => {
    expect(await grep().reach({ pattern: "x" })).toEqual(tree(real));
    expect(await grep().reach({ pattern: "x", path: "." })).toEqual(
      tree(real),
    );
  });

  test("declares the file extent of the followed existing file for grep", async () => {
    const expected = paths(join(real, "a.txt"));

    expect(await grep().reach({ pattern: "x", path: "a.txt" })).toEqual(
      expected,
    );
    expect(await grep().reach({ pattern: "x", path: "to-a" })).toEqual(
      expected,
    );
  });

  test("is any-local for grep on a path that does not exist yet", async () => {
    expect(
      await grep().reach({ pattern: "x", path: "missing" }),
    ).toEqual(anyLocal);
    expect(
      await grep().reach({ pattern: "x", path: "sub/new" }),
    ).toEqual(anyLocal);
  });

  test("is any-local for grep when the path cannot be followed", async () => {
    expect(await grep().reach({ pattern: "x", path: "dead" })).toEqual(
      anyLocal,
    );
    expect(await grep().reach({ pattern: "x", path: "loop1" })).toEqual(
      anyLocal,
    );
  });
});

describe("web_search reach", () => {
  test("is outside for every argument and never calls the backend", async () => {
    const tool = createWebSearchTool({ backend: failingBackend });

    expect(await tool.reach({ query: "a" })).toEqual({
      kind: "outside",
    });
    expect(await tool.reach({})).toEqual({ kind: "outside" });
  });
});
