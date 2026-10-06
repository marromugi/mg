import { randomUUID } from "node:crypto";
import { mkdir, open, type FileHandle } from "node:fs/promises";
import { join } from "node:path";

export class BashOutputSaveError extends Error {
  readonly path: string;

  constructor(path: string, cause: unknown) {
    const reason =
      cause instanceof Error ? cause.message : String(cause);
    super(`could not save the full output to ${path}: ${reason}`, {
      cause,
    });
    this.name = "BashOutputSaveError";
    this.path = path;
  }
}

export type BoundedOutput = {
  /** What fits in the limit, without one trailing newline. */
  text: string;
  totalBytes: number;
  totalLines: number;
  /** Number of the first line that `text` shows. */
  shownFromLine: number;
  /** True when `text` is only the end of the last line. */
  lastLinePartial: boolean;
  lastLineBytes: number;
  /** Set when the output passed the limit. */
  savedPath?: string;
  /** True when output past `maxSavedBytes` was dropped. */
  savedCapReached: boolean;
};

export type BoundedOutputOptions = {
  maxBytes: number;
  dir: string;
  maxSavedBytes: number;
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

export const createBoundedOutput = (
  options: BoundedOutputOptions,
): BoundedOutputSink => {
  const { maxBytes, dir, maxSavedBytes, onStop } = options;
  const keepBytes = 2 * maxBytes + 2;

  let tail: Buffer[] = [];
  let tailBytes = 0;
  let totalBytes = 0;
  let newlines = 0;
  let currentLineBytes = 0;
  let previousLineBytes = 0;
  let capReached = false;

  let savedPath: string | undefined;
  let handle: FileHandle | undefined;
  let writes: Promise<void> = Promise.resolve();
  let saveError: BashOutputSaveError | undefined;
  let stopped = false;

  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    onStop();
  };

  const fail = (path: string, cause: unknown): void => {
    saveError ??= new BashOutputSaveError(path, cause);
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

  const trimTail = (): void => {
    if (tailBytes <= 2 * keepBytes) return;
    const joined = Buffer.concat(tail);
    const kept = joined.subarray(joined.length - keepBytes);
    tail = [kept];
    tailBytes = kept.length;
  };

  const count = (chunk: Buffer): void => {
    let position = 0;
    for (;;) {
      const index = chunk.indexOf(NEWLINE, position);
      if (index === -1) break;
      newlines++;
      previousLineBytes = currentLineBytes + (index - position);
      currentLineBytes = 0;
      position = index + 1;
    }
    currentLineBytes += chunk.length - position;
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
      tail.push(accepted);
      tailBytes += accepted.length;

      if (totalBytes > maxBytes) {
        if (before <= maxBytes) {
          openFile();
          write(Buffer.concat(tail));
        } else {
          write(accepted);
        }
      }
      trimTail();
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
        totalBytes,
        totalLines,
        lastLineBytes,
        savedCapReached: capReached,
      };

      const all = Buffer.concat(tail);
      const body = endsWithNewline ? all.subarray(0, -1) : all;
      const decoder = new TextDecoder();

      if (savedPath === undefined) {
        return {
          ...base,
          text: decoder.decode(body),
          shownFromLine: 1,
          lastLinePartial: false,
        };
      }

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
          shownFromLine: totalLines,
          lastLinePartial: true,
          savedPath,
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
      let shownLines = 1;
      for (const byte of shown) if (byte === NEWLINE) shownLines++;
      return {
        ...base,
        text: decoder.decode(shown),
        shownFromLine: totalLines - shownLines + 1,
        lastLinePartial: false,
        savedPath,
      };
    },
  };
};
