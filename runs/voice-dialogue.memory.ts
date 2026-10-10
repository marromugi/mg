import type { RunDialogue } from "@mg/dialogue";

// The persona's reflections run one at a time, in reply order, off the
// path of the reply. add takes a reflection that does not reject; idle
// settles once every reflection added so far has ended.
export type ReflectionQueue = {
  add(reflection: Promise<unknown>): void;
  idle(): Promise<void>;
};

export const createReflectionQueue = (): ReflectionQueue => {
  let tail: Promise<void> = Promise.resolve();
  return {
    add: (reflection) => {
      tail = Promise.all([tail, reflection]).then(
        () => undefined,
        () => undefined,
      );
    },
    idle: () => tail,
  };
};

// Prints each memory line after the line of the reply it belongs to.
// The n-th memory outcome belongs to the n-th reply the person heard.
export type MemoryReport = {
  memory(line: string): void;
  replied(): void;
  // prints what is still held back
  drain(): void;
};

export const createMemoryReport = (
  out: (line: string) => void,
): MemoryReport => {
  const lines: string[] = [];
  let replies = 0;
  let printed = 0;
  const flush = (limit: number) => {
    while (printed < lines.length && printed < limit) {
      out(lines[printed]);
      printed += 1;
    }
  };
  return {
    memory: (line) => {
      lines.push(line);
      flush(replies);
    },
    replied: () => {
      replies += 1;
      flush(replies);
    },
    drain: () => flush(lines.length),
  };
};

// Tells the report when the person has heard a reply.
export const reportingReplies =
  (dialogue: RunDialogue, report: MemoryReport): RunDialogue =>
  (options, context) =>
    dialogue(options, {
      ...context,
      onEvent: (event) => {
        context.onEvent?.(event);
        if (event.type === "reply") report.replied();
      },
    });
