import type { Shown } from "./shown.js";

// What happens while an agent answers one message of a trial
// conversation, in the form the page receives it.
export type TrialEvent =
  | { type: "started"; conversationId: string }
  | { type: "text"; delta: string }
  // `subject` is what the call acts on, when the tool has one.
  | {
      type: "tool-call";
      id: string;
      name: string;
      subject?: string;
      input: Shown;
    }
  // `refused` when a guard kept the tool from running; `result` is then
  // what the agent was told instead of one.
  | { type: "tool-result"; id: string; result: Shown; refused: boolean }
  | { type: "ended" }
  | { type: "failed"; message: string };
