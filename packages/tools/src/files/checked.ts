import {
  constants,
  promises as nodeFs,
  type BigIntStats,
} from "node:fs";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { FileToolError } from "./errors.js";

export type CheckedFs = Pick<typeof nodeFs, "lstat" | "open">;

export type CheckedOpenOptions = {
  root: string;
  fs?: CheckedFs;
  noFollow?: number | undefined;
  // How the caller wrote the path; named in not-found and not-a-file
  // errors. Defaults to the path relative to the root.
  named?: string;
};

// A check that found the declared path no longer what it was.
export class PathCheckError extends FileToolError {}

const isErrnoException = (
  error: unknown,
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const changed = (relative: string): PathCheckError =>
  new PathCheckError(`path changed after it was checked: ${relative}`);

const cannotCheck = (
  relative: string,
  reason: string,
  cause?: unknown,
): PathCheckError =>
  new PathCheckError(
    `cannot check path: ${relative}: ${reason}`,
    cause === undefined ? undefined : { cause },
  );

const notFound = (relative: string): FileToolError =>
  new FileToolError(`file not found: ${relative}`);

const NO_INODE = "the file system reports no inode";

type Located = {
  base: string;
  parts: string[];
  relative: string;
  named: string;
};

const cannotResolve = (named: string): FileToolError =>
  new FileToolError(`cannot resolve path: ${named}`);

const within = (base: string, target: string): string | undefined => {
  const relative = path.relative(base, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return undefined;
  }
  return relative;
};

const locate = async (
  declared: string,
  root: string,
  named: string | undefined,
): Promise<Located> => {
  for (const base of [await nodeFs.realpath(root), root]) {
    const relative = within(base, declared);
    if (relative === undefined) continue;
    const parts = relative === "" ? [] : relative.split(path.sep);
    const joined = parts.length === 0 ? "." : parts.join("/");
    return { base, parts, relative: joined, named: named ?? joined };
  }
  throw new FileToolError(`path is outside the root: ${declared}`);
};

type Phase = "before" | "after";

// lstat each part below the root. A link anywhere stops the action.
// Returns the last part's stat, or undefined when only that part is
// absent before the open.
const walk = async (
  fs: CheckedFs,
  located: Located,
  phase: Phase,
): Promise<BigIntStats | undefined> => {
  let current = located.base;
  let last: BigIntStats | undefined;
  for (const [index, part] of located.parts.entries()) {
    current = path.join(current, part);
    try {
      last = await fs.lstat(current, { bigint: true });
    } catch (error) {
      if (
        isErrnoException(error) &&
        (error.code === "ENOENT" || error.code === "ENOTDIR")
      ) {
        if (phase === "after") throw changed(located.relative);
        if (error.code === "ENOTDIR")
          throw cannotResolve(located.named);
        if (index === located.parts.length - 1) return undefined;
        throw notFound(located.named);
      }
      throw cannotCheck(
        located.relative,
        error instanceof Error ? error.message : String(error),
        error,
      );
    }
    if (last.isSymbolicLink()) throw changed(located.relative);
  }
  return last;
};

// Stops the action when a part of the declared path is now a link,
// is gone, or cannot be checked.
export const checkDeclared = async (
  declared: string,
  options: CheckedOpenOptions,
): Promise<void> => {
  const located = await locate(declared, options.root, options.named);
  const last = await walk(options.fs ?? nodeFs, located, "before");
  if (last === undefined && located.parts.length > 0) {
    throw notFound(located.named);
  }
};

// Opens the declared absolute path (links followed at declaration)
// and hands back a handle to the file that is still there.
export const openDeclared = async (
  declared: string,
  flags: number,
  options: CheckedOpenOptions,
): Promise<FileHandle> => {
  const fs = options.fs ?? nodeFs;
  const noFollow =
    "noFollow" in options ? options.noFollow : constants.O_NOFOLLOW;
  const located = await locate(declared, options.root, options.named);

  const before = await walk(fs, located, "before");
  if (located.parts.length === 0 || (before && !before.isFile())) {
    throw new FileToolError(`not a file: ${located.relative}`);
  }

  let handle: FileHandle;
  try {
    handle = await fs.open(declared, flags | (noFollow ?? 0));
  } catch (error) {
    if (isErrnoException(error)) {
      if (error.code === "ELOOP") throw changed(located.relative);
      if (error.code === "ENOENT") throw notFound(located.named);
      if (error.code === "ENOTDIR") throw cannotResolve(located.named);
    }
    throw error;
  }

  try {
    const after = await walk(fs, located, "after");
    const opened = await handle.stat({ bigint: true });
    if (after === undefined || after.ino === 0n || opened.ino === 0n) {
      throw cannotCheck(located.relative, NO_INODE);
    }
    if (after.dev !== opened.dev || after.ino !== opened.ino) {
      throw changed(located.relative);
    }
  } catch (error) {
    await handle.close();
    throw error;
  }
  return handle;
};
