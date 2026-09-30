import { promises as fs } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createEditFileTool } from "./edit.js";
import { createGrepTool } from "./grep.js";
import { createReadFileTool } from "./read.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mg-swap-")));
  await fs.mkdir(join(root, "sub"));
  await fs.mkdir(join(root, "other"));
  await fs.writeFile(join(root, "sub", "a.txt"), "A");
  await fs.writeFile(join(root, "other", "a.txt"), "SECRET");
  await fs.writeFile(join(root, "b.txt"), "B");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const swapSub = async (): Promise<void> => {
  await fs.rename(join(root, "sub"), join(root, "sub.old"));
  await fs.symlink(join(root, "other"), join(root, "sub"));
};

const failure = async (run: Promise<unknown>): Promise<string> => {
  try {
    await run;
  } catch (error) {
    return (error as Error).message;
  }
  return "did not fail";
};

describe("a link swapped in after preparing", () => {
  test("read_file fails when a directory on its path became a link", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "sub/a.txt",
    });
    await swapSub();

    await expect(failure(call.run({}))).resolves.toBe(
      "path changed after it was checked: sub/a.txt",
    );
  });

  test("edit_file fails and changes nothing when a directory became a link", async () => {
    const call = await createEditFileTool({ root }).prepare({
      path: "sub/a.txt",
      oldString: "SECRET",
      newString: "X",
    });
    await swapSub();

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
    await expect(
      fs.readFile(join(root, "other", "a.txt"), "utf-8"),
    ).resolves.toBe("SECRET");
  });

  test("grep fails when the searched directory or file became a link", async () => {
    const grep = createGrepTool({ root });
    const inDir = await grep.prepare({
      pattern: "SECRET",
      path: "sub",
    });
    const inFile = await grep.prepare({
      pattern: "SECRET",
      path: "sub/a.txt",
    });
    await swapSub();

    await expect(inDir.run({})).rejects.toThrow(
      "path changed after it was checked: sub",
    );
    await expect(inFile.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
  });

  test("read_file fails when the file itself became a link", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "b.txt",
    });
    await fs.rm(join(root, "b.txt"));
    await fs.symlink(join(root, "other", "a.txt"), join(root, "b.txt"));

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: b.txt",
    );
  });

  test("read_file reads a file that did not exist when prepared", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "sub/new.txt",
    });
    await fs.writeFile(join(root, "sub", "new.txt"), "N");

    await expect(call.run({})).resolves.toBe("1\tN");
  });

  test("read_file fails when a file that did not exist became a link", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "sub/new.txt",
    });
    await fs.symlink(
      join(root, "other", "a.txt"),
      join(root, "sub", "new.txt"),
    );

    await expect(failure(call.run({}))).resolves.toBe(
      "path changed after it was checked: sub/new.txt",
    );
  });

  test("a deleted file and a file that became a directory keep their errors", async () => {
    const read = await createReadFileTool({ root }).prepare({
      path: "sub/a.txt",
    });
    const edit = await createEditFileTool({ root }).prepare({
      path: "sub/a.txt",
      oldString: "A",
      newString: "Z",
    });
    await fs.rm(join(root, "sub", "a.txt"));
    await expect(read.run({})).rejects.toThrow(
      "file not found: sub/a.txt",
    );

    await fs.mkdir(join(root, "sub", "a.txt"));
    await expect(edit.run({})).rejects.toThrow("not a file: sub/a.txt");
  });

  test("read_file names a missing file as it was typed, through a link inside the root", async () => {
    await fs.symlink(join(root, "sub"), join(root, "link"));
    const call = await createReadFileTool({ root }).prepare({
      path: "link/missing.txt",
    });

    await expect(call.run({})).rejects.toThrow(
      "file not found: link/missing.txt",
    );
  });

  test("read_file reports a missing file outside the root as not found", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "../nope.txt",
    });

    await expect(call.run({})).rejects.toThrow(
      "file not found: ../nope.txt",
    );
  });

  test("read_file cannot resolve a path whose parent became a file", async () => {
    const call = await createReadFileTool({ root }).prepare({
      path: "sub/a.txt",
    });
    await fs.rm(join(root, "sub"), { recursive: true });
    await fs.writeFile(join(root, "sub"), "F");

    await expect(call.run({})).rejects.toThrow(
      "cannot resolve path: sub/a.txt",
    );
  });
});
