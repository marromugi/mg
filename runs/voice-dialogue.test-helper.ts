import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Message } from "@mg/core";
import type { Persona } from "@mg/persona";
import type { MemoryOutcome } from "@mg/runner";

// A persona that recalls a fixed instruction and records what it is
// asked to reflect on.
export const personaOf = (options: { recallFails?: Error } = {}) => {
  const remembered: (readonly Message[])[] = [];
  const memories: MemoryOutcome<string>[] = [];
  const persona: Persona<string, string> = {
    id: "p",
    async recall() {
      if (options.recallFails !== undefined) throw options.recallFails;
      return { instruction: "ゆっくり話します", read: "r" };
    },
    async remember(request) {
      remembered.push(request.entry);
      return {
        updated: true,
        added: ["梨が好き"],
        personaChanged: false,
        forgotten: [],
      };
    },
  };
  return {
    persona,
    counterparts: [{ id: "user", name: "User" }],
    tracePath: join(
      tmpdir(),
      `voice-dialogue-test-${randomUUID()}.jsonl`,
    ),
    onMemory: (memory: MemoryOutcome<string>) => {
      memories.push(memory);
    },
    remembered,
    memories,
  };
};
