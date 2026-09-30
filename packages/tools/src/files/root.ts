import { promises as fs } from "node:fs";
import path from "node:path";
import type { Reach } from "@mg/core";
import { FileToolError } from "./errors.js";

export type ResolvedPath = { absolute: string; relative: string };

const toRelative = (rootReal: string, real: string): string => {
  const relative = path.relative(rootReal, real);
  return relative === "" ? "." : relative.split(path.sep).join("/");
};

const isWithinRoot = (rootReal: string, real: string): boolean => {
  const prefix = rootReal.endsWith(path.sep)
    ? rootReal
    : rootReal + path.sep;
  return real === rootReal || real.startsWith(prefix);
};

const assertWithinRoot = (
  rootReal: string,
  real: string,
  input: string,
): void => {
  const prefix = rootReal.endsWith(path.sep)
    ? rootReal
    : rootReal + path.sep;
  if (real !== rootReal && !real.startsWith(prefix)) {
    throw new FileToolError(`path is outside the root: ${input}`);
  }
};

const isErrnoException = (
  error: unknown,
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export const resolveExistingPath = async (
  root: string,
  input: string,
): Promise<ResolvedPath> => {
  const rootReal = await fs.realpath(root);
  const abs = path.resolve(rootReal, input);

  let real: string;
  try {
    real = await fs.realpath(abs);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new FileToolError(`file not found: ${input}`);
    }
    throw new FileToolError(`cannot resolve path: ${input}`, {
      cause: error,
    });
  }

  assertWithinRoot(rootReal, real, input);
  return { absolute: real, relative: toRelative(rootReal, real) };
};

export const resolveWritablePath = async (
  root: string,
  input: string,
): Promise<ResolvedPath> => {
  const rootReal = await fs.realpath(root);
  const abs = path.resolve(rootReal, input);

  let existing = abs;
  const rest: string[] = [];
  for (;;) {
    let real: string | undefined;
    try {
      real = await fs.realpath(existing);
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") {
        throw new FileToolError(`cannot resolve path: ${input}`, {
          cause: error,
        });
      }

      let entryExists = true;
      try {
        await fs.lstat(existing);
      } catch (lstatError) {
        if (
          isErrnoException(lstatError) &&
          lstatError.code === "ENOENT"
        ) {
          entryExists = false;
        } else {
          throw new FileToolError(`cannot resolve path: ${input}`, {
            cause: lstatError,
          });
        }
      }

      if (entryExists) {
        throw new FileToolError(`path is outside the root: ${input}`);
      }
    }

    if (real !== undefined) {
      assertWithinRoot(rootReal, real, input);
      const full = rest.length > 0 ? path.join(real, ...rest) : real;
      return { absolute: full, relative: toRelative(rootReal, full) };
    }

    const parent = path.dirname(existing);
    if (parent === existing) {
      throw new FileToolError(`cannot resolve path: ${input}`);
    }
    rest.unshift(path.basename(existing));
    existing = parent;
  }
};

const anyLocal: Reach = { kind: "any-local" };

const entryExists = async (target: string): Promise<boolean> => {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
};

const followedPath = async (
  root: string,
  input: string,
): Promise<string> => {
  const abs = path.resolve(await fs.realpath(root), input);

  let existing = abs;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await fs.realpath(existing);
      return rest.length > 0 ? path.join(real, ...rest) : real;
    } catch (error) {
      if (!isErrnoException(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
    if (await entryExists(existing)) {
      throw new Error("dangling link");
    }

    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("no existing parent");
    rest.unshift(path.basename(existing));
    existing = parent;
  }
};

export const reachOfFile = async (
  root: string,
  input: string,
): Promise<Reach> => {
  try {
    const followed = await followedPath(root, input);
    return {
      kind: "paths",
      paths: [{ path: followed, extent: "file" }],
    };
  } catch {
    return anyLocal;
  }
};

// The path a prepared call acts on: the one it declared, or, when it
// declared any-local, the one resolved now.
export const declaredTarget = async (
  root: string,
  input: string,
  reach: Reach,
): Promise<ResolvedPath> => {
  const declared =
    reach.kind === "paths" && reach.paths.length === 1
      ? reach.paths[0]
      : undefined;
  if (declared === undefined) return resolveExistingPath(root, input);

  const rootReal = await fs.realpath(root);
  if (!isWithinRoot(rootReal, declared.path)) {
    return resolveExistingPath(root, input);
  }
  return {
    absolute: declared.path,
    relative: toRelative(rootReal, declared.path),
  };
};

export const reachOfSearchPath = async (
  root: string,
  input: string,
): Promise<Reach> => {
  try {
    const followed = await followedPath(root, input);
    const stat = await fs.stat(followed);
    return {
      kind: "paths",
      paths: [
        {
          path: followed,
          extent: stat.isDirectory() ? "tree" : "file",
        },
      ],
    };
  } catch {
    return anyLocal;
  }
};
