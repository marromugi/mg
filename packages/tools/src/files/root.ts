import { promises as fs } from "node:fs";
import path from "node:path";
import { FileToolError } from "./errors.js";

export type ResolvedPath = { absolute: string; relative: string };

const toRelative = (rootReal: string, real: string): string => {
  const relative = path.relative(rootReal, real);
  return relative === "" ? "." : relative.split(path.sep).join("/");
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
