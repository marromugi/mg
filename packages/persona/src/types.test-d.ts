import type { Extraction, Persona, RememberOutcome } from "./types.js";

declare const persona: Persona<string, number>;

void persona.recall({
  counterparts: [],
  conversation: "c1",
  input: "hi",
});

void persona.recall(
  { counterparts: [], conversation: "c1", input: "hi" },
  undefined,
  // @ts-expect-error recall takes no persona id
  "p1",
);

export const extractionWithVersion = {
  summary: "s",
  items: [],
  // @ts-expect-error Extraction has no version field
  version: 1,
} satisfies Extraction;

declare const outcome: RememberOutcome<number>;

if (!outcome.updated && outcome.reason === "forget-failed") {
  const pending: string[] = outcome.pending;
  void pending;
}
