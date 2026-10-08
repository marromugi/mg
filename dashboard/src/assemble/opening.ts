import type { Message } from "@mg/core";
import type { HarnessDefinition } from "../definition/index.js";

// The messages a run of the definition starts with: its system prompt
// when it has one, then what the person sent.
export const openingMessages = (
  definition: HarnessDefinition,
  input: string,
): Message[] => [
  ...(definition.system === undefined
    ? []
    : [{ role: "system" as const, content: definition.system }]),
  { role: "user", content: input },
];
