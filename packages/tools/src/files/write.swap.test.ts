import { promises as fs } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CheckedWriteFs } from "./checked.js";
import { createWriteFileTool } from "./write.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mg-write-")));
  await fs.mkdir(join(root, "sub"));
  await fs.mkdir(join(root, "other"));
  await fs.writeFile(join(root, "sub", "a.txt"), "OLD");
  await fs.writeFile(join(root, "other", "a.txt"), "SECRET");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const swapSub = async (): Promise<void> => {
  await fs.rename(join(root, "sub"), join(root, "sub.old"));
  await fs.symlink(join(root, "other"), join(root, "sub"));
};

const read = (...parts: string[]): Promise<string> =>
  fs.readFile(join(root, ...parts), "utf-8");

const exists = (...parts: string[]): Promise<boolean> =>
  fs.access(join(root, ...parts)).then(
    () => true,
    () => false,
  );

const realFs: CheckedWriteFs = {
  lstat: fs.lstat,
  open: fs.open,
  mkdir: fs.mkdir,
};

describe("write_file with a change after preparing", () => {
  test("fails when a folder on its path became a link", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "sub/a.txt",
      content: "NEW",
    });
    await swapSub();

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
    await expect(read("other", "a.txt")).resolves.toBe("SECRET");
  });

  test("fails when the file became a link", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "sub/a.txt",
      content: "NEW",
    });
    await fs.rm(join(root, "sub", "a.txt"));
    await fs.symlink(
      join(root, "other", "a.txt"),
      join(root, "sub", "a.txt"),
    );

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
    await expect(read("other", "a.txt")).resolves.toBe("SECRET");
  });

  test("lists the folders it created when one of them became a link", async () => {
    const call = await createWriteFileTool({
      root,
      fs: {
        ...realFs,
        mkdir: async (target) => {
          await fs.mkdir(target);
          if (target === join(root, "n1", "n2")) {
            await fs.rename(target, join(root, "n1", "n2.old"));
            await fs.symlink(join(root, "other"), target);
          }
        },
      },
    }).prepare({ path: "n1/n2/n3/f.txt", content: "NEW" });

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: n1/n2/n3/f.txt (created before stopping: n1, n1/n2)",
    );
    await expect(exists("other", "n3")).resolves.toBe(false);
    expect((await fs.lstat(join(root, "n1"))).isDirectory()).toBe(true);
    expect(
      (await fs.lstat(join(root, "n1", "n2.old"))).isDirectory(),
    ).toBe(true);
  });

  test("keeps the old content when a check after the open fails", async () => {
    const call = await createWriteFileTool({
      root,
      fs: {
        ...realFs,
        open: async (...args) => {
          const handle = await fs.open(...args);
          await swapSub();
          return handle;
        },
      },
    }).prepare({ path: "sub/a.txt", content: "NEW" });

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
    await expect(read("sub.old", "a.txt")).resolves.toBe("OLD");
    await expect(read("other", "a.txt")).resolves.toBe("SECRET");
  });

  test("writes over a file that did not exist when prepared", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "sub/b.txt",
      content: "NEW",
    });
    await fs.writeFile(join(root, "sub", "b.txt"), "THEIRS");

    await expect(call.run({})).resolves.toBe(
      "Wrote sub/b.txt (1 lines).",
    );
    await expect(read("sub", "b.txt")).resolves.toBe("NEW");
  });

  test("creates a file that was deleted after preparing", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "sub/a.txt",
      content: "NEW",
    });
    await fs.rm(join(root, "sub", "a.txt"));

    await expect(call.run({})).resolves.toBe(
      "Wrote sub/a.txt (1 lines).",
    );
    await expect(read("sub", "a.txt")).resolves.toBe("NEW");
  });

  test("uses a folder another writer created as a real folder", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "n1/f.txt",
      content: "NEW",
    });
    await fs.mkdir(join(root, "n1"));

    await expect(call.run({})).resolves.toBe(
      "Wrote n1/f.txt (1 lines).",
    );
  });

  test("fails without following a link at the file when links cannot be refused at the open", async () => {
    const call = await createWriteFileTool({
      root,
      noFollow: undefined,
    }).prepare({ path: "sub/a.txt", content: "NEW" });
    await fs.rm(join(root, "sub", "a.txt"));
    await fs.symlink(
      join(root, "other", "new.txt"),
      join(root, "sub", "a.txt"),
    );

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/a.txt",
    );
    await expect(exists("other", "new.txt")).resolves.toBe(false);
  });

  test("fails when a folder that did not exist became a link", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "n1/f.txt",
      content: "NEW",
    });
    await fs.symlink(join(root, "other"), join(root, "n1"));

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: n1/f.txt",
    );
    await expect(exists("other", "f.txt")).resolves.toBe(false);
  });

  test("fails when a file that did not exist became a link", async () => {
    const call = await createWriteFileTool({ root }).prepare({
      path: "sub/b.txt",
      content: "NEW",
    });
    await fs.symlink(
      join(root, "other", "new.txt"),
      join(root, "sub", "b.txt"),
    );

    await expect(call.run({})).rejects.toThrow(
      "path changed after it was checked: sub/b.txt",
    );
    await expect(exists("other", "new.txt")).resolves.toBe(false);
  });

  test("fails when a check cannot be made", async () => {
    const call = await createWriteFileTool({
      root,
      fs: {
        ...realFs,
        lstat: async () => {
          throw Object.assign(new Error("EIO: i/o error"), {
            code: "EIO",
          });
        },
      },
    }).prepare({ path: "sub/a.txt", content: "NEW" });

    await expect(call.run({})).rejects.toThrow(
      "cannot check path: sub/a.txt: EIO: i/o error",
    );
  });

  test("with no change, creates folders and refuses a folder as the target", async () => {
    const tool = createWriteFileTool({ root });

    await expect(
      (await tool.prepare({ path: "sub/x/y.txt", content: "NEW" })).run(
        {},
      ),
    ).resolves.toBe("Wrote sub/x/y.txt (1 lines).");
    await expect(read("sub", "x", "y.txt")).resolves.toBe("NEW");
    await expect(
      (await tool.prepare({ path: "sub", content: "NEW" })).run({}),
    ).rejects.toThrow("not a file: sub");
  });
});
