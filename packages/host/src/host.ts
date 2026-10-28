import type { Message, Tool } from "@mg/core";
import {
  ConversationExistsError,
  type ConversationEntry,
  type ConversationStore,
} from "@mg/conversation";
import type { Gate } from "@mg/gate";
import {
  createInbox,
  type Clock,
  type InboxItem,
  type InboxStore,
} from "@mg/inbox";
import {
  continueConversation,
  type ContinueOutcome,
  type NotSavedReason,
  type RunConfig,
} from "@mg/runner";
import { Hono } from "hono";
import { createAdmission } from "./admission.js";
import { createLaterOnlyGate } from "./gate.js";
import { createLaterTool } from "./later.js";
import type {
  Client,
  ReplyFilter,
  ReplyLog,
  ReplyRecord,
} from "./types.js";

/** What the host gives the agent for one run. */
export type AgentMeans = {
  /** Lets the agent get back to the conversation it is running in. */
  tools: readonly Tool[];
  /** Allows those tools and refuses every other call. */
  gate: Gate;
};

export type HostOptions = {
  /** Builds the agent for one input from the means the host gives it. */
  agent: (means: AgentMeans) => RunConfig;
  /**
   * Told to the agent at the start of each turn, given the time now in
   * milliseconds since the epoch.
   */
  instruction?: (now: number) => string;
  conversations: ConversationStore;
  inbox: InboxStore;
  replies: ReplyLog;
  clients: readonly Client[];
  clock?: Clock;
  /** Called when the gate refuses a call; `tool` is its name, if any. */
  onRefusal?: (tool: string | undefined) => void;
  /** Called with what went wrong outside any request. Defaults to stderr. */
  onError?: (error: Error) => void;
};

export interface Host {
  app: Hono;
  /** Loads pending input and delivers what is due. */
  start(): Promise<void>;
  /**
   * Ends open reply streams and waits for runs in flight. The stores
   * and the reply log stay open; whoever opened them closes them.
   */
  close(): Promise<void>;
}

const unauthorized = { error: "unauthorized" };

const describeNotSaved = (reason: NotSavedReason): string => {
  switch (reason.kind) {
    case "diverged":
    case "not-in-result":
      return `not saved: ${reason.kind}`;
    case "keep-failed":
    case "append-failed":
      return `not saved: ${reason.kind}: ${
        reason.error instanceof Error
          ? reason.error.message
          : String(reason.error)
      }`;
  }
};

const replyText = (messages: readonly Message[]): string => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant") {
      return message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("");
    }
  }
  return "";
};

const runAgent = (
  agent: RunConfig,
  conversations: ConversationStore,
  id: string,
  messages: [Message, ...Message[]],
): Promise<ContinueOutcome> => {
  const conversation = {
    store: conversations,
    id,
    history: { kind: "all" } as const,
    messages,
  };
  return continueConversation(agent, conversation);
};

const ensureConversation = async (
  conversations: ConversationStore,
  id: string,
): Promise<void> => {
  try {
    await conversations.create(id);
  } catch (error) {
    if (!(error instanceof ConversationExistsError)) {
      throw error;
    }
  }
};

/** The entry at `position`, if the conversation has grown past it. */
const savedTurn = async (
  conversations: ConversationStore,
  id: string,
  position: number,
  length: number,
): Promise<ConversationEntry | undefined> => {
  if (length <= position) {
    return undefined;
  }
  const slice = await conversations.read(id, {
    kind: "last",
    count: length - position,
  });
  return slice.entries[0];
};

/**
 * What the agent reads for a stored input. A client's words go in as
 * they are; the agent's own note is marked as one.
 */
const inputText = (item: InboxItem): string => {
  const { text, from } = (item.input ?? {}) as {
    text?: unknown;
    from?: unknown;
  };
  if (typeof text !== "string") {
    throw new TypeError("The stored input has no text.");
  }
  if (from === undefined || from === "client") {
    return text;
  }
  if (from === "agent") {
    return `[note to self, set at ${new Date(item.addedAt).toISOString()}]\n${text}`;
  }
  throw new TypeError(
    `The stored input comes from "${String(from)}", not "client" or "agent".`,
  );
};

const ndjson = (
  records: AsyncIterable<ReplyRecord>,
): ReadableStream<Uint8Array> => {
  const encoder = new TextEncoder();
  const iterator = records[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    pull: async (controller) => {
      const next = await iterator.next();
      if (next.done === true) {
        controller.close();
        return;
      }
      controller.enqueue(
        encoder.encode(`${JSON.stringify(next.value)}\n`),
      );
    },
    cancel: () => {
      void iterator.return?.();
    },
  });
};

export const createHost = (options: HostOptions): Host => {
  const { conversations, replies } = options;
  const now = (): number => (options.clock ?? Date).now();
  const gate = createLaterOnlyGate(options.onRefusal);
  const admit = createAdmission(options.clients);
  const onError =
    options.onError ??
    ((error: Error) => {
      console.error(error);
    });
  const closing = new AbortController();

  const inbox = createInbox({
    store: options.inbox,
    clock: options.clock,
    run: async (item: InboxItem) => {
      const text = inputText(item);
      let record;
      try {
        await ensureConversation(conversations, item.conversationId);
        const { length } = await conversations.read(
          item.conversationId,
          {
            kind: "all",
          },
        );
        const noted = await replies.begin(item.id, length);
        if (!noted.first) {
          // An earlier run of this item was cut short. Reuse what it
          // left instead of calling the model again.
          if (await replies.hasReplyFor(item.id)) {
            return;
          }
          const saved = await savedTurn(
            conversations,
            item.conversationId,
            noted.entryCount,
            length,
          );
          if (saved !== undefined) {
            await replies.append({
              kind: "reply",
              text: replyText(saved.messages),
              conversationId: item.conversationId,
              inputId: item.id,
            });
            return;
          }
        }
        const agent = options.agent({
          tools: [
            createLaterTool({
              inbox,
              replies,
              conversationId: item.conversationId,
              inputId: item.id,
              now,
            }),
          ],
          gate,
        });
        const user: Message = { role: "user", content: text };
        const outcome = await runAgent(
          agent,
          conversations,
          item.conversationId,
          options.instruction === undefined
            ? [user]
            : [
                { role: "system", content: options.instruction(now()) },
                user,
              ],
        );
        record = outcome.saved
          ? {
              kind: "reply" as const,
              text: replyText(outcome.entry.messages),
            }
          : {
              kind: "failed" as const,
              reason: describeNotSaved(outcome.reason),
            };
      } catch (error) {
        record = {
          kind: "failed" as const,
          reason:
            error instanceof Error ? error.message : String(error),
        };
      }
      await replies.append({
        ...record,
        conversationId: item.conversationId,
        inputId: item.id,
      });
    },
    onSettle: (item, outcome) => {
      if (outcome.kind === "failed") {
        onError(
          new Error(
            `Input "${item.id}" of conversation "${item.conversationId}" failed: ${outcome.reason}`,
          ),
        );
      }
    },
    onError,
  });

  const app = new Hono();

  app.use("*", async (c, next) => {
    if (admit(c.req.header("authorization")) === undefined) {
      return c.json(unauthorized, 401);
    }
    await next();
  });

  app.post("/conversations/:id/inputs", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "The body is not valid JSON." }, 400);
    }
    const { text, dueAt } = (body ?? {}) as {
      text?: unknown;
      dueAt?: unknown;
    };
    if (typeof text !== "string") {
      return c.json({ error: '"text" must be a string.' }, 400);
    }
    if (
      dueAt !== undefined &&
      !(typeof dueAt === "number" && Number.isFinite(dueAt))
    ) {
      return c.json(
        { error: '"dueAt" must be a finite number of milliseconds.' },
        400,
      );
    }
    const item = await inbox.add(
      c.req.param("id"),
      { text },
      dueAt === undefined ? undefined : { dueAt },
    );
    return c.json({ id: item.id, dueAt: item.dueAt }, 202);
  });

  app.get("/replies", (c) => {
    const raw = c.req.query("after") ?? "0";
    const after = Number(raw);
    if (!Number.isSafeInteger(after) || after < 0) {
      return c.json(
        { error: '"after" must be a cursor, a whole number from 0.' },
        400,
      );
    }
    const conversationIds = c.req.queries("conversation");
    const prefix = c.req.query("prefix");
    if (conversationIds?.includes("") === true || prefix === "") {
      return c.json(
        {
          error:
            '"conversation" and "prefix" must not be empty when given.',
        },
        400,
      );
    }
    const filter: ReplyFilter = {
      conversations: conversationIds,
      prefix,
    };
    const signal = AbortSignal.any([c.req.raw.signal, closing.signal]);
    return new Response(ndjson(replies.watch(after, signal, filter)), {
      headers: { "content-type": "application/x-ndjson" },
    });
  });

  return {
    app,
    start: () => inbox.start(),
    async close() {
      closing.abort();
      await inbox.close();
    },
  };
};
