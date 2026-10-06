import { randomUUID } from "node:crypto";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export class OutputSaveError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const reason =
      cause instanceof Error ? cause.message : String(cause);
    super(`could not save the full output to ${path}: ${reason}`, {
      cause,
    });
    this.name = "OutputSaveError";
    this.path = path;
  }
}

export type Keep = "start" | "end";

export type BoundedOutput = {
  /** What fits in the limit, without one trailing newline. */
  text: string;
  keep: Keep;
  totalBytes: number;
  totalLines: number;
  /** The lines `text` shows, counted from 1. */
  shownLines: { from: number; to: number };
  /** True when `text` is only part of one line: its start or its end. */
  partialLine: boolean;
  /** Size of that line; 0 when `partialLine` is false. */
  partialLineBytes: number;
  /** Set when the output passed the limit. */
  savedPath?: string;
  /** True when output past `maxSavedBytes` was dropped. */
  savedCapReached: boolean;
};

export type BoundedOutputOptions = {
  maxBytes: number;
  dir: string;
  maxSavedBytes: number;
  /** Which end of the output stays when it passes `maxBytes`. */
  keep: Keep;
  /** Called once when the producer should stop: cap reached or save failed. */
  onStop: () => void;
};

export type BoundedOutputSink = {
  append(chunk: Buffer): void;
  finish(): Promise<BoundedOutput>;
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const NEWLINE = 10;

const startsContinuation = (byte: number): boolean =>
  (byte & 0xc0) === 0x80;

const countNewlines = (bytes: Uint8Array): number => {
  let n = 0;
  for (const byte of bytes) if (byte === NEWLINE) n++;
  return n;
};

export const createBoundedOutput = (
  options: BoundedOutputOptions,
): BoundedOutputSink => {
  const { maxBytes, dir, maxSavedBytes, keep, onStop } = options;
  // The end keeps room to find a line start; the start keeps one byte
  // past the limit to see whether the cut falls on a line end.
  const keepBytes = keep === "end" ? 2 * maxBytes + 2 : maxBytes + 1;

  let held: Buffer[] = [];
  let heldBytes = 0;
  let totalBytes = 0;
  let newlines = 0;
  let currentLineBytes = 0;
  let previousLineBytes = 0;
  let firstLineBytes: number | undefined;
  let capReached = false;

  let savedPath: string | undefined;
  let handle: FileHandle | undefined;
  let writes: Promise<void> = Promise.resolve();
  let saveError: OutputSaveError | undefined;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    onStop();
  };

  const fail = (path: string, cause: unknown): void => {
    saveError ??= new OutputSaveError(path, cause);
    stop();
  };

  const write = (data: Buffer): void => {
    writes = writes.then(async () => {
      if (saveError !== undefined || handle === undefined) return;
      try {
        await handle.write(data);
      } catch (cause) {
        fail(savedPath ?? dir, cause);
      }
    });
  };

  const openFile = (): void => {
    const path = join(dir, `${randomUUID()}.txt`);
    savedPath = path;
    writes = mkdir(dir, { recursive: true })
      .then(async () => {
        handle = await open(path, "w");
      })
      .catch((cause: unknown) => {
        fail(path, cause);
      });
  };

  const hold = (chunk: Buffer): void => {
    if (keep === "start") {
      if (heldBytes >= keepBytes) return;
      const part = chunk.subarray(0, keepBytes - heldBytes);
      held.push(part);
      heldBytes += part.length;
      return;
    }
    held.push(chunk);
    heldBytes += chunk.length;
    if (heldBytes > 2 * keepBytes) {
      const kept = Buffer.concat(held).subarray(-keepBytes);
      held = [kept];
      heldBytes = kept.length;
    }
  };

  const count = (chunk: Buffer): void => {
    let position = 0;
    for (;;) {
      const index = chunk.indexOf(NEWLINE, position);
      if (index === -1) break;
      newlines++;
      previousLineBytes = currentLineBytes + (index - position);
      firstLineBytes ??= previousLineBytes;
      currentLineBytes = 0;
      position = index + 1;
    }
    currentLineBytes += chunk.length - position;
  };

  const finishEnd = (
    body: Buffer,
    base: Omit<BoundedOutput, "text" | "shownLines" | "partialLine">,
    all: Buffer,
    path: string,
  ): BoundedOutput => {
    const decoder = new TextDecoder();
    const { totalLines } = base;
    const lastLineStart = body.lastIndexOf(NEWLINE) + 1;
    const droppedBefore = totalBytes - all.length;
    const lastLineTooLong =
      body.length - lastLineStart > maxBytes ||
      (lastLineStart === 0 && droppedBefore > 0);

    if (lastLineTooLong) {
      let start = body.length - maxBytes;
      while (start < body.length && startsContinuation(body[start])) {
        start++;
      }
      return {
        ...base,
        text: decoder.decode(body.subarray(start)),
        shownLines: { from: totalLines, to: totalLines },
        partialLine: true,
        savedPath: path,
      };
    }

    let shown = body;
    if (body.length > maxBytes) {
      const from = body.length - maxBytes;
      shown = body.subarray(from);
      if (body[from - 1] !== NEWLINE) {
        shown = shown.subarray(shown.indexOf(NEWLINE) + 1);
      }
    }
    return {
      ...base,
      text: decoder.decode(shown),
      shownLines: {
        from: totalLines - countNewlines(shown),
        to: totalLines,
      },
      partialLine: false,
      partialLineBytes: 0,
      savedPath: path,
    };
  };

  const finishStart = (
    all: Buffer,
    base: Omit<BoundedOutput, "text" | "shownLines" | "partialLine">,
    path: string,
  ): BoundedOutput => {
    const decoder = new TextDecoder();
    // `all` is the first maxBytes + 1 bytes: the cut falls between
    // all[maxBytes - 1] and all[maxBytes].
    const lineEnd = all.lastIndexOf(NEWLINE);

    if (lineEnd === -1) {
      let end = maxBytes;
      while (end > 0 && startsContinuation(all[end])) end--;
      return {
        ...base,
        text: decoder.decode(all.subarray(0, end)),
        shownLines: { from: 1, to: 1 },
        partialLine: true,
        savedPath: path,
      };
    }

    const shown = all.subarray(0, lineEnd);
    return {
      ...base,
      text: decoder.decode(shown),
      shownLines: { from: 1, to: countNewlines(shown) + 1 },
      partialLine: false,
      partialLineBytes: 0,
      savedPath: path,
    };
  };

  return {
    append(chunk) {
      if (capReached || saveError !== undefined || chunk.length === 0) {
        return;
      }
      let accepted = chunk;
      if (totalBytes + chunk.length > maxSavedBytes) {
        accepted = chunk.subarray(0, maxSavedBytes - totalBytes);
        capReached = true;
      }

      const before = totalBytes;
      totalBytes += accepted.length;
      count(accepted);

      if (totalBytes > maxBytes) {
        if (before <= maxBytes) {
          openFile();
          write(Buffer.concat([...held, accepted]));
        } else {
          write(accepted);
        }
      }
      hold(accepted);
      if (capReached) stop();
    },

    async finish() {
      await writes;
      if (handle !== undefined) {
        try {
          await handle.close();
        } catch (cause) {
          fail(savedPath ?? dir, cause);
        }
      }
      if (saveError !== undefined) throw saveError;

      const endsWithNewline = totalBytes > 0 && currentLineBytes === 0;
      const totalLines =
        newlines + (endsWithNewline || totalBytes === 0 ? 0 : 1);
      const lastLineBytes = endsWithNewline
        ? previousLineBytes
        : currentLineBytes;
      const base = {
        keep,
        totalBytes,
        totalLines,
        partialLineBytes:
          keep === "end"
            ? lastLineBytes
            : (firstLineBytes ?? totalBytes),
        savedCapReached: capReached,
      };

      const all = Buffer.concat(held);

      if (savedPath === undefined) {
        const body = endsWithNewline ? all.subarray(0, -1) : all;
        return {
          ...base,
          partialLineBytes: 0,
          text: new TextDecoder().decode(body),
          shownLines: { from: 1, to: totalLines },
          partialLine: false,
        };
      }

      if (keep === "start") return finishStart(all, base, savedPath);
      const body = endsWithNewline ? all.subarray(0, -1) : all;
      return finishEnd(body, base, all, savedPath);
    },
  };
};
