import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { FileToolError } from "./errors.js";
import { resolveExistingPath, resolveWritablePath } from "./root.js";

const dir = mkdtempSync(join(tmpdir(), "mg-tools-files-root-"));
const root = realpathSync(dir);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("resolveExistingPath", () => {
  test("resolves a relative path inside the root, with / in relative", async () => {
    await mkdir(join(root, "sub"), { recursive: true });
    await writeFile(join(root, "sub", "a.txt"), "hi");

    const resolved = await resolveExistingPath(root, "sub/a.txt");

    expect(resolved.absolute).toBe(join(root, "sub", "a.txt"));
    expect(resolved.relative).toBe("sub/a.txt");
  });

  test("resolves an absolute path inside the root", async () => {
    await writeFile(join(root, "b.txt"), "hi");

    const resolved = await resolveExistingPath(
      root,
      join(root, "b.txt"),
    );

    expect(resolved.absolute).toBe(join(root, "b.txt"));
    expect(resolved.relative).toBe("b.txt");
  });

  test("rejects a path that escapes the root with ..", async () => {
    await expect(
      resolveExistingPath(root, "../outside.txt"),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a symlink inside the root that points outside it", async () => {
    const outsideDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-outside-"),
    );
    const outsideFile = join(outsideDir, "secret.txt");
    await writeFile(outsideFile, "secret");
    await symlink(outsideFile, join(root, "escape.txt"));

    await expect(
      resolveExistingPath(root, "escape.txt"),
    ).rejects.toBeInstanceOf(FileToolError);

    rmSync(outsideDir, { recursive: true, force: true });
  });

  test("rejects a missing file", async () => {
    await expect(
      resolveExistingPath(root, "missing.txt"),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("accepts a child path when the root is the filesystem root", async () => {
    const rootDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-fsroot-"),
    );
    const filePath = join(rootDir, "c.txt");
    await writeFile(filePath, "hi");

    const resolved = await resolveExistingPath("/", filePath);

    expect(resolved.absolute).toBe(realpathSync(filePath));

    rmSync(rootDir, { recursive: true, force: true });
  });
});

describe("resolveWritablePath", () => {
  test("resolves a missing file directly under the root", async () => {
    const resolved = await resolveWritablePath(root, "new.txt");

    expect(resolved.absolute).toBe(join(root, "new.txt"));
    expect(resolved.relative).toBe("new.txt");
  });

  test("resolves a missing file under a missing ancestor directory", async () => {
    const resolved = await resolveWritablePath(
      root,
      "newdir/nested/new.txt",
    );

    expect(resolved.absolute).toBe(
      join(root, "newdir", "nested", "new.txt"),
    );
    expect(resolved.relative).toBe("newdir/nested/new.txt");
  });

  test("still checks the nearest existing ancestor when deeper parts are missing", async () => {
    const outsideDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-outside2-"),
    );
    await symlink(outsideDir, join(root, "escape-dir"));

    await expect(
      resolveWritablePath(root, "escape-dir/nested/new.txt"),
    ).rejects.toBeInstanceOf(FileToolError);

    rmSync(outsideDir, { recursive: true, force: true });
  });

  test("rejects a broken symlink at the target pointing outside the root", async () => {
    const outsideDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-outside3-"),
    );
    const missingOutsideTarget = join(outsideDir, "missing.txt");
    rmSync(outsideDir, { recursive: true, force: true });
    await symlink(missingOutsideTarget, join(root, "broken.txt"));

    await expect(
      resolveWritablePath(root, "broken.txt"),
    ).rejects.toBeInstanceOf(FileToolError);
  });

  test("rejects a broken symlink as an ancestor directory pointing outside the root", async () => {
    const outsideDir = mkdtempSync(
      join(tmpdir(), "mg-tools-files-outside4-"),
    );
    const missingOutsideDir = join(outsideDir, "missing-dir");
    rmSync(outsideDir, { recursive: true, force: true });
    await symlink(missingOutsideDir, join(root, "broken-dir"));

    await expect(
      resolveWritablePath(root, "broken-dir/nested/new.txt"),
    ).rejects.toBeInstanceOf(FileToolError);
  });
});
