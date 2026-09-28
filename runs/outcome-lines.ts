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
