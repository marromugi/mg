// 書き方は packages/runner/agent-guide.md を見てください。
import type { Message } from "@mg/core";
import { createOpenRouterProvider } from "@mg/core";
import { ConversationExistsError } from "@mg/conversation";
import { openSqliteConversationStore } from "@mg/conversation/sqlite";
import { PersonaExistsError } from "@mg/memory";
import { openSqliteMemoryStore } from "@mg/memory/sqlite";
import type { StartOptions } from "@mg/runner";
import { continueAsPersona, defineRun, runOnTrigger } from "@mg/runner";
import { term } from "@mg/term";
import type { TextTriggerInput } from "@mg/trigger";
import { createJevPersona } from "./persona-jev.persona.ts";
import { trigger } from "./trigger-jev.trigger.ts";

const apiKey = process.env.OPENROUTER_API_KEY;
if (apiKey === undefined)
  throw new Error("OPENROUTER_API_KEY is not set");

const runConfig = defineRun({
  name: "persona-jev",
  provider: createOpenRouterProvider({ apiKey }),
  harness: { kind: "loop", model: "openai/gpt-4o-mini", maxTurns: 10 },
  trace: { jsonlPath: "./trace.jsonl" },
});

const PERSONA_ID = "jev";
const CONVERSATION_ID = "jev";
const COUNTERPARTS = [{ id: "user", name: "User" }];

const memoryStore = await openSqliteMemoryStore(
  "./persona-memory.sqlite",
);
try {
  await memoryStore.create(PERSONA_ID, "I am Jev.");
} catch (error) {
  if (!(error instanceof PersonaExistsError)) throw error;
}

const conversationStore = await openSqliteConversationStore(
  "./persona-conversation.sqlite",
);
try {
  await conversationStore.create(CONVERSATION_ID);
} catch (error) {
  if (!(error instanceof ConversationExistsError)) throw error;
}

const persona = createJevPersona({ store: memoryStore });

const toMessages = (input: TextTriggerInput): Message[] => [
  {
    role: "user",
    content: `The user just muttered to themselves: "${input.text}"`,
  },
];

const startFor =
  (input: TextTriggerInput) =>
  (messages: Message[], options: StartOptions) => {
    const [first, ...rest] = messages;
    if (first === undefined) {
      throw new Error("toMessages returned no messages");
    }
    return continueAsPersona(
      runConfig,
      {
        store: conversationStore,
        id: CONVERSATION_ID,
        history: { kind: "all" },
        messages: [first, ...rest],
      },
      {
        persona,
        counterparts: COUNTERPARTS,
        input: input.text,
        trace: { jsonlPath: "./persona-trace.jsonl" },
      },
      options,
    );
  };

const inputs: TextTriggerInput[] = [
  { kind: "note", text: "そういえば明日何かあったっけ" },
  { kind: "note", text: "今日はいい天気だな" },
  { kind: "note", text: "来週のミーティングの資料、まだ作ってない" },
];

for (const input of inputs) {
  const outcome = await runOnTrigger(
    {
      trigger,
      toMessages,
      start: startFor(input),
      trace: { jsonlPath: "./trigger-trace.jsonl" },
    },
    input,
  );

  const tone = outcome.fired ? "success" : "muted";
  const mark = outcome.fired ? term.mark.success : term.mark.muted;

  console.log(
    term.paint("strong", `${term.mark.strong} ${input.text}`),
  );
  console.log(term.paint(tone, `  ${mark} fired: ${outcome.fired}`));

  if (outcome.fired) {
    console.log(
      term.paint(tone, `  saved: ${outcome.run.saved ? "yes" : "no"}`),
    );
    if (outcome.run.saved) {
      console.log(
        term.paint(
          tone,
          `  memory: ${JSON.stringify(outcome.run.memory)}`,
        ),
      );
    } else {
      console.log(
        term.paint(
          tone,
          `  reason: ${JSON.stringify(outcome.run.reason)}`,
        ),
      );
    }
  } else {
    console.log(
      term.paint(tone, `  reason: ${outcome.decision.reason}`),
    );
  }
}
