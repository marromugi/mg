import { constants, promises as fs } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { openDeclared, type CheckedFs } from "./checked.js";

let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "mg-checked-")));
  await fs.mkdir(join(root, "sub"));
  await fs.mkdir(join(root, "other"));
  await fs.writeFile(join(root, "sub", "a.txt"), "A");
  await fs.writeFile(join(root, "other", "a.txt"), "SECRET");
});

afterEach(() => rm(root, { recursive: true, force: true }));

const swapSub = async (): Promise<void> => {
  await fs.rename(join(root, "sub"), join(root, "sub.old"));
  await fs.symlink(join(root, "other"), join(root, "sub"));
};

const putSubBack = async (): Promise<void> => {
  await fs.unlink(join(root, "sub"));
  await fs.rename(join(root, "sub.old"), join(root, "sub"));
};

describe("openDeclared", () => {
  test("a directory swapped for a link before the open is caught after it", async () => {
    const checkedFs: CheckedFs = {
      lstat: fs.lstat,
      open: async (...args) => {
        await swapSub();
        return fs.open(...args);
      },
    };

    await expect(
      openDeclared(join(root, "sub", "a.txt"), constants.O_RDONLY, {
        root,
        fs: checkedFs,
      }),
    ).rejects.toThrow("path changed after it was checked: sub/a.txt");
  });

  test("a directory swapped for a link during the open and put back is caught", async () => {
    const checkedFs: CheckedFs = {
      lstat: fs.lstat,
      open: async (...args) => {
        await swapSub();
        const handle = await fs.open(...args);
        await putSubBack();
        return handle;
      },
    };

    await expect(
      openDeclared(join(root, "sub", "a.txt"), constants.O_RDONLY, {
        root,
        fs: checkedFs,
      }),
    ).rejects.toThrow("path changed after it was checked: sub/a.txt");
  });

  test("a link as the last part is refused when the platform cannot refuse it at the open", async () => {
    await fs.symlink(join(root, "other", "a.txt"), join(root, "b.txt"));

    await expect(
      openDeclared(join(root, "b.txt"), constants.O_RDONLY, {
        root,
        noFollow: undefined,
      }),
    ).rejects.toThrow("path changed after it was checked: b.txt");
  });

  test("a failing lstat is reported with its message", async () => {
    const checkedFs: CheckedFs = {
      lstat: async () => {
        throw Object.assign(new Error("EIO: i/o error"), {
          code: "EIO",
        });
      },
      open: fs.open,
    };

    await expect(
      openDeclared(join(root, "sub", "a.txt"), constants.O_RDONLY, {
        root,
        fs: checkedFs,
      }),
    ).rejects.toThrow("cannot check path: sub/a.txt: EIO: i/o error");
  });

  test("an inode of 0 is reported as a check that cannot be made", async () => {
    const checkedFs: CheckedFs = {
      lstat: fs.lstat,
      open: async (...args) => {
        const handle = await fs.open(...args);
        handle.stat = (async () => {
          const stat = await fs.lstat(join(root, "sub", "a.txt"), {
            bigint: true,
          });
          return Object.assign(stat, { ino: 0n });
        }) as typeof handle.stat;
        return handle;
      },
    };

    await expect(
      openDeclared(join(root, "sub", "a.txt"), constants.O_RDONLY, {
        root,
        fs: checkedFs,
      }),
    ).rejects.toThrow(
      "cannot check path: sub/a.txt: the file system reports no inode",
    );
  });
});
