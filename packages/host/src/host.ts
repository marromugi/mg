import type { Message } from "@mg/core";
import {
  ConversationExistsError,
  type ConversationStore,
} from "@mg/conversation";
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
import type { Client, ReplyLog, ReplyRecord } from "./types.js";

export type HostOptions = {
  /** The agent every input runs on. Its gate is required when it has tools. */
  agent: RunConfig;
  conversations: ConversationStore;
  inbox: InboxStore;
  replies: ReplyLog;
  clients: readonly Client[];
  clock?: Clock;
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
  text: string,
): Promise<ContinueOutcome> => {
  const conversation = {
    store: conversations,
    id,
    history: { kind: "all" } as const,
    messages: [{ role: "user", content: text }] as [Message],
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

const textOf = (input: unknown): string => {
  const text = (input as { text?: unknown } | null)?.text;
  if (typeof text !== "string") {
    throw new TypeError("The stored input has no text.");
  }
  return text;
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
  const { agent, conversations, replies } = options;
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
      const text = textOf(item.input);
      let record;
      try {
        await ensureConversation(conversations, item.conversationId);
        const outcome = await runAgent(
          agent,
          conversations,
          item.conversationId,
          text,
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
    const signal = AbortSignal.any([c.req.raw.signal, closing.signal]);
    return new Response(ndjson(replies.watch(after, signal)), {
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
