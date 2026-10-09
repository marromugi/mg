import type { Message } from "@mg/core";
import { textOf } from "@mg/core";
import type { MemoryOutcome } from "@mg/runner";
import { describeError } from "./show-run.ts";

export function memoryLines<TRead>(
  memory: MemoryOutcome<TRead>,
): string[] {
  if (memory.updated) {
    return [`  memory: ${JSON.stringify(memory)}`];
  }

  const lines = [
    `  reason: ${memory.reason}`,
    `  error: ${describeError(memory.error)}`,
  ];

  if (memory.reason === "forget-failed") {
    lines.push(
      `  added: ${JSON.stringify(memory.added)}`,
      `  personaChanged: ${memory.personaChanged}`,
      `  pending: ${JSON.stringify(memory.pending)}`,
    );
  }

  return lines;
}

export function judgeFailureLine(
  judge: string,
  error: unknown,
): string {
  return `${judge}: ${describeError(error)}`;
}

export function replyLines(messages: readonly Message[]): string[] {
  const last = messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  if (last === undefined) return [];
  const text = textOf(last);
  return text === "" ? [] : [`  reply: ${text}`];
}
