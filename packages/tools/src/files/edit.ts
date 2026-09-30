import { constants } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import type { Tool } from "@mg/core";
import { z } from "zod";
import { FileToolError } from "./errors.js";
import { openDeclared } from "./checked.js";
import { declaredTarget, reachOfFile } from "./root.js";
import { isBinary } from "./text.js";

export type EditFileToolOptions = { root: string };

const editFileInput = z.object({
  path: z.string().min(1).describe("File path relative to the root"),
  oldString: z
    .string()
    .min(1)
    .describe(
      "Exact text to replace; must match once unless replaceAll",
    ),
  newString: z.string().describe("Replacement text"),
  replaceAll: z
    .boolean()
    .optional()
    .describe("Replace every occurrence"),
});

const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

const MAX_LISTED_LINES = 20;

const findOccurrenceIndices = (
  content: string,
  oldString: string,
): number[] => {
  const indices: number[] = [];
  let fromIndex = 0;
  for (;;) {
    const index = content.indexOf(oldString, fromIndex);
    if (index === -1) return indices;
    indices.push(index);
    fromIndex = index + oldString.length;
  }
};

const lineOf = (content: string, index: number): number =>
  content.slice(0, index).split("\n").length;

const formatLineList = (lines: number[]): string => {
  const capped = lines.length > MAX_LISTED_LINES;
  const shown = capped ? lines.slice(0, MAX_LISTED_LINES) : lines;
  return capped ? `${shown.join(", ")}, …` : shown.join(", ");
};

const spliceContent = (
  content: string,
  indices: number[],
  oldString: string,
  newString: string,
): string => {
  let result = "";
  let cursor = 0;
  for (const index of indices) {
    result += content.slice(cursor, index) + newString;
    cursor = index + oldString.length;
  }
  return result + content.slice(cursor);
};

const writeAll = async (
  handle: FileHandle,
  buffer: Buffer,
): Promise<void> => {
  await handle.truncate(0);
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await handle.write(
      buffer,
      offset,
      buffer.length - offset,
      offset,
    );
    offset += bytesWritten;
  }
};

export const createEditFileTool = (
  options: EditFileToolOptions,
): Tool<typeof editFileInput> => {
  const { root } = options;

  return {
    name: "edit_file",
    description:
      "Replaces oldString with newString in a UTF-8 file under the " +
      "root. oldString must match exactly once (include surrounding " +
      "lines to disambiguate) unless replaceAll is true; fails " +
      "without changing the file otherwise.",
    input: editFileInput,
    async prepare({
      path: inputPath,
      oldString,
      newString,
      replaceAll,
    }) {
      const reach = await reachOfFile(root, inputPath);
      return {
        reach,
        run: async (context) => {
          context.signal?.throwIfAborted();

          const resolved = await declaredTarget(root, inputPath, reach);
          const handle = await openDeclared(
            resolved.absolute,
            constants.O_RDWR,
            { root, named: inputPath },
          );
          try {
            const buffer = await handle.readFile({
              signal: context.signal,
            });
            let content: string;
            try {
              content = new TextDecoder("utf-8", {
                fatal: true,
              }).decode(buffer);
            } catch {
              throw new FileToolError(
                `not valid UTF-8: ${resolved.relative}`,
              );
            }

            if (isBinary(content)) {
              throw new FileToolError(
                `binary file: ${resolved.relative}`,
              );
            }

            if (oldString === newString) {
              throw new FileToolError(
                "oldString and newString are identical",
              );
            }

            const indices = findOccurrenceIndices(content, oldString);

            if (indices.length === 0) {
              throw new FileToolError(
                `oldString not found in ${resolved.relative}`,
              );
            }

            if (indices.length >= 2 && !replaceAll) {
              const lines = indices.map((index) =>
                lineOf(content, index),
              );
              throw new FileToolError(
                `oldString matches ${indices.length} times in ${resolved.relative} ` +
                  `(lines ${formatLineList(lines)}). Include more surrounding ` +
                  "text to make it unique, or set replaceAll.",
              );
            }

            const targetIndices = replaceAll
              ? indices
              : indices.slice(0, 1);
            const updated = spliceContent(
              content,
              targetIndices,
              oldString,
              newString,
            );

            try {
              await writeAll(handle, Buffer.from(updated, "utf8"));
            } catch (error) {
              if (isAbortError(error)) throw error;
              throw new FileToolError(
                `cannot write file: ${resolved.relative}`,
                { cause: error },
              );
            }

            const lines = targetIndices.map((index) =>
              lineOf(content, index),
            );
            const count = targetIndices.length;
            const noun = count === 1 ? "occurrence" : "occurrences";
            const lineWord = count === 1 ? "line" : "lines";
            return (
              `Replaced ${count} ${noun} in ${resolved.relative} ` +
              `(${lineWord} ${formatLineList(lines)}).`
            );
          } finally {
            await handle.close();
          }
        },
      };
    },
  };
};
