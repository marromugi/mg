import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Estimator, Message } from "@mg/core";
import type { HarnessEvent } from "@mg/harness";
import {
  TOOL_CALL_KIND,
  type Gate,
  type ToolCallPayload,
} from "@mg/gate";
import { run as realRun, type RunEntry } from "@mg/runner";
import { assemble, openingMessages } from "../assemble/index.js";
import type { HarnessDefinition } from "../definition/index.js";
import type { SecretStore } from "../secret-store/index.js";
import { createEventLog } from "./event-log.js";
import type { TrialEvent } from "./events.js";
import { presentCall, type Shown } from "./shown.js";

export const TRACE_DIR_NAME = "traces";

// Holds conversations with agents for as long as the server lives.
export interface Trials {
  // Sends one message into a conversation with the definition; without
  // `conversationId` a new conversation starts, with the definition's
  // system prompt. Gives each event until the agent stops answering:
  // "started" names the conversation, and the last is "ended" or
  // "failed". Aborting `signal` cuts the answer short and ends the
  // events with neither.
  send(
    definition: HarnessDefinition,
    input: string,
    options?: { conversationId?: string; signal?: AbortSignal },
  ): AsyncIterable<TrialEvent>;
}

type Conversation = {
  messages: Message[];
  // How many messages have been sent into it.
  sent: number;
  answering: boolean;
};

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const failed = (message: string): TrialEvent => ({
  type: "failed",
  message,
});

// The same gate, noting in `refused` the id of each tool call it does
// not let through, whether it says no or cannot judge.
const noting = (gate: Gate, refused: Set<string>): Gate => ({
  judge: async (request, context) => {
    const note = () => {
      if (request.kind !== TOOL_CALL_KIND) return;
      refused.add((request.payload as ToolCallPayload).call.id);
    };
    try {
      const verdict = await gate.judge(request, context);
      if (!verdict.allowed) note();
      return verdict;
    } catch (error) {
      note();
      throw error;
    }
  },
});

// Turns the events of one run into the ones the page receives. It
// keeps how each tool call shows its result until the result comes.
const createShower = (refused: ReadonlySet<string>) => {
  const results = new Map<string, (text: string) => Shown>();

  return (event: HarnessEvent): TrialEvent | undefined => {
    switch (event.type) {
      case "text-delta":
        return { type: "text", delta: event.delta };
      case "tool-call": {
        const { id, name } = event.toolCall;
        const { result, ...shown } = presentCall(
          name,
          event.toolCall.arguments,
        );
        results.set(id, result);
        return { type: "tool-call", id, name, ...shown };
      }
      case "tool-result": {
        const id = event.message.toolCallId;
        const { content } = event.message;
        const isRefused = refused.has(id);
        const show = isRefused ? undefined : results.get(id);
        return {
          type: "tool-result",
          id,
          result:
            show === undefined
              ? { kind: "code", language: "text", text: content }
              : show(content),
          refused: isRefused,
        };
      }
      default:
        return undefined;
    }
  };
};

export const createTrials = (parts: {
  secrets: SecretStore;
  dataDir: string;
  // The estimator a harness's gate asks.
  jev?: Estimator;
  run?: RunEntry;
}): Trials => {
  const run = parts.run ?? realRun;
  const conversations = new Map<string, Conversation>();

  return {
    send: async function* (definition, input, options = {}) {
      const { signal } = options;
      const id = options.conversationId ?? randomUUID();
      const known = conversations.get(id);
      if (options.conversationId !== undefined && known === undefined) {
        yield failed(
          "この会話はもう残っていません。新しい会話を始めてください",
        );
        return;
      }
      const conversation = known ?? {
        messages: openingMessages(definition, input).slice(0, -1),
        sent: 0,
        answering: false,
      };
      if (conversation.answering) {
        yield failed("前の返答がまだ終わっていません");
        return;
      }

      let assembled: Awaited<ReturnType<typeof assemble>>;
      try {
        assembled = await assemble(definition, {
          secrets: parts.secrets,
          tracePath: join(
            parts.dataDir,
            TRACE_DIR_NAME,
            `${id}-${conversation.sent + 1}.jsonl`,
          ),
          jev: parts.jev,
        });
      } catch (error) {
        yield failed(reasonOf(error));
        return;
      }
      if (!assembled.ok) {
        yield failed(`${assembled.missingSecret} が設定されていません`);
        return;
      }

      conversations.set(id, conversation);
      conversation.answering = true;
      conversation.sent += 1;
      const messages: Message[] = [
        ...conversation.messages,
        { role: "user", content: input },
      ];
      const log = createEventLog<TrialEvent>();
      log.push({ type: "started", conversationId: id });

      const refused = new Set<string>();
      const shownOf = createShower(refused);
      const { config } = assembled;
      void run(
        config.gate === undefined
          ? config
          : { ...config, gate: noting(config.gate, refused) },
        messages,
        {
          signal,
          wrapUp: signal,
          onEvent: (event) => {
            const shown = shownOf(event);
            if (shown !== undefined) log.push(shown);
          },
        },
      )
        .then(
          ({ result }) => {
            conversation.messages = result.messages;
            if (signal?.aborted !== true) log.push({ type: "ended" });
          },
          (error: unknown) => {
            conversation.messages = messages;
            if (signal?.aborted !== true) {
              log.push(failed(reasonOf(error)));
            }
          },
        )
        .finally(() => {
          conversation.answering = false;
          log.close();
        });

      yield* log.watch();
    },
  };
};
