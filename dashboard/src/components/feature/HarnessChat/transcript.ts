import type { Shown } from "../../../trial/shown.js";

// One entry of a trial conversation, in the order it happened.
export type ChatItem =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      // What the call acts on, when the tool has one.
      subject?: string;
      input: Shown;
      // Absent while the tool is still working. `refused` when a guard
      // kept the tool from running.
      result?: { shown: Shown; refused: boolean };
    }
  // The conversation starts over from here with the prompt as it now is.
  | { kind: "restarted"; id: string }
  | { kind: "stopped"; id: string }
  | { kind: "failed"; id: string; message: string };

// A conversation with the agent that lasts while the page is open.
// `send` takes the prompt as it is now, so an edit is tried unsaved.
export type Trial = {
  items: readonly ChatItem[];
  state: "idle" | "answering";
  send: (input: string, system: string) => void;
  stop: () => void;
  reset: () => void;
};
