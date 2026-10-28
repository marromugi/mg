import type { Tool } from "@mg/core";
import type { Inbox } from "@mg/inbox";
import { z } from "zod";
import type { ReplyLog } from "./types.js";

export const LATER_TOOL = "later";
export const MIN_LATER_SECONDS = 1;
export const MAX_LATER_SECONDS = 7 * 24 * 60 * 60;

const laterInput = z.object({
  inSeconds: z
    .number()
    .describe(
      `Whole seconds from now, ${MIN_LATER_SECONDS} to ${MAX_LATER_SECONDS}`,
    ),
  note: z.string().describe("What to do when the time comes"),
});

export type LaterOptions = {
  inbox: Pick<Inbox, "add">;
  replies: Pick<ReplyLog, "append">;
  /** The conversation the note goes into. */
  conversationId: string;
  /** The input being run, which the `scheduled` record answers. */
  inputId: string;
  now: () => number;
};

const failure = (reason: string): string => `error: ${reason}`;

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * The agent's way to get back to one conversation later. It cannot
 * name another conversation.
 */
export const createLaterTool = (
  options: LaterOptions,
): Tool<typeof laterInput> => ({
  name: LATER_TOOL,
  description:
    "Leaves a note for this conversation to be answered later. " +
    "At the time you set, the note comes back as an input and your " +
    "reply reaches the client like any other. " +
    "Returns when it is due, in milliseconds since the epoch.",
  input: laterInput,
  async prepare({ inSeconds, note }) {
    return {
      reach: { kind: "none" },
      async run() {
        if (
          !Number.isInteger(inSeconds) ||
          inSeconds < MIN_LATER_SECONDS ||
          inSeconds > MAX_LATER_SECONDS
        ) {
          return failure(
            `inSeconds must be a whole number from ${MIN_LATER_SECONDS} to ${MAX_LATER_SECONDS}. Nothing was scheduled.`,
          );
        }
        const dueAt = options.now() + inSeconds * 1000;
        try {
          await options.inbox.add(
            options.conversationId,
            { text: note, from: "agent" },
            { dueAt },
          );
        } catch (error) {
          return failure(
            `the note could not be scheduled: ${describe(error)}`,
          );
        }
        try {
          await options.replies.append({
            kind: "scheduled",
            dueAt,
            note,
            conversationId: options.conversationId,
            inputId: options.inputId,
          });
        } catch (error) {
          return failure(
            `the note is scheduled for ${dueAt} but the client could not be told: ${describe(error)}`,
          );
        }
        return JSON.stringify({ dueAt });
      },
    };
  },
});
