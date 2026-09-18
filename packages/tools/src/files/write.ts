import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "@mg/core";
import { z } from "zod";
import { FileToolError } from "./errors.js";
import { resolveWritablePath } from "./root.js";
import { splitLines } from "./text.js";

export type WriteFileToolOptions = { root: string };

const writeFileInput = z.object({
  path: z.string().min(1).describe("File path relative to the root"),
  content: z.string().describe("Full file content; replaces the file"),
});

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const isErrnoException = (
  error: unknown,
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

export const createWriteFileTool = (
  options: WriteFileToolOptions,
): Tool<typeof writeFileInput> => {
  const { root } = options;

  return {
    name: "write_file",
    description:
      "Writes the whole content to a UTF-8 file under the root, " +
      "creating parent directories and overwriting without asking. " +
      "For partial changes use edit_file.",
    input: writeFileInput,
    async execute({ path: inputPath, content }, context) {
      context.signal?.throwIfAborted();

      const resolved = await resolveWritablePath(root, inputPath);

      try {
        const stat = await fs.stat(resolved.absolute);
        if (stat.isDirectory()) {
          throw new FileToolError(`not a file: ${resolved.relative}`);
        }
      } catch (error) {
        if (error instanceof FileToolError) throw error;
        if (!isErrnoException(error) || error.code !== "ENOENT") {
          throw new FileToolError(
            `cannot write file: ${resolved.relative}`,
            { cause: error },
          );
        }
      }

      try {
        await fs.mkdir(path.dirname(resolved.absolute), {
          recursive: true,
        });
        await fs.writeFile(resolved.absolute, content, "utf8");
      } catch (error) {
        if (isAbortError(error)) throw error;
        throw new FileToolError(
          `cannot write file: ${resolved.relative}`,
          { cause: error },
        );
      }

      const lines = splitLines(content).length;
      return `Wrote ${resolved.relative} (${lines} lines).`;
    },
  };
};
