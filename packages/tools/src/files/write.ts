import type { FileHandle } from "node:fs/promises";
import type { Tool } from "@mg/core";
import { z } from "zod";
import {
  openDeclaredForWrite,
  type CheckedWriteFs,
} from "./checked.js";
import { FileToolError } from "./errors.js";
import {
  declaredTarget,
  reachOfFile,
  resolveWritablePath,
} from "./root.js";
import { splitLines } from "./text.js";

export type WriteFileToolOptions = {
  root: string;
  fs?: CheckedWriteFs;
  noFollow?: number | undefined;
};

const writeFileInput = z.object({
  path: z.string().min(1).describe("File path relative to the root"),
  content: z.string().describe("Full file content; replaces the file"),
});

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const overwrite = async (
  handle: FileHandle,
  content: string,
  signal: AbortSignal | undefined,
): Promise<void> => {
  await handle.truncate(0);
  await handle.writeFile(content, { encoding: "utf8", signal });
};

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
    async prepare({ path: inputPath, content }) {
      const reach = await reachOfFile(root, inputPath);
      return {
        reach,
        run: async (context) => {
          context.signal?.throwIfAborted();

          const resolved = await declaredTarget(
            root,
            inputPath,
            reach,
            resolveWritablePath,
          );
          const handle = await openDeclaredForWrite(resolved.absolute, {
            ...options,
            named: inputPath,
          });
          try {
            await overwrite(handle, content, context.signal);
          } catch (error) {
            if (isAbortError(error)) throw error;
            throw new FileToolError(
              `cannot write file: ${resolved.relative}`,
              { cause: error },
            );
          } finally {
            await handle.close();
          }

          const lines = splitLines(content).length;
          return `Wrote ${resolved.relative} (${lines} lines).`;
        },
      };
    },
  };
};
