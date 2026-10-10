import { createMemoryConversationStore } from "@mg/conversation";
import { createOpenRouterProvider } from "@mg/core";
import { runDialogue } from "@mg/dialogue";
import { createGeminiTranscriber } from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { spawnProcess } from "./node-spawn.ts";
import { readLevel } from "./level-argument.ts";
import { memoryLine } from "./outcome-lines.ts";
import { outputPath } from "./outputs.ts";
import {
  COUNTERPARTS,
  openSamplePersonaMemory,
} from "./persona-jev.memory.ts";
import { createJevPersona } from "./persona-jev.persona.ts";
import { resolveSpeech } from "./speech-settings.ts";
import {
  createMemoryReport,
  createReflectionQueue,
  reportingReplies,
} from "./voice-dialogue.memory.ts";
import {
  createDialogueCollaborators,
  createTalkerConfig,
  createWorkerConfig,
  openSessionTrace,
} from "./voice-dialogue.build.ts";
import { runLive } from "./voice-dialogue.run.ts";
import { LISTENER_LEVEL_DB } from "./voice-dialogue.values.ts";

const usage = "usage: node runs/voice-dialogue.ts [microphone] [level]";
const level = readLevel(process.argv[3], LISTENER_LEVEL_DB, usage);
if (!level.ok) {
  console.error(level.usage);
  process.exit(2);
}

const need = (name: string): string => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
};

const geminiApiKey = need("GEMINI_API_KEY");
const openRouterApiKey = need("OPENROUTER_API_KEY");
const provider = createOpenRouterProvider({
  apiKey: openRouterApiKey,
});
const talkerProvider = createOpenRouterProvider({
  apiKey: openRouterApiKey,
  reasoning: false,
});
const estimator = createSampleJevEstimator({
  apiKey: need("TYPESAFE_API_KEY"),
});

const runTracePath = outputPath("voice-dialogue-run-trace.jsonl");

const aborter = new AbortController();
process.once("SIGINT", () => aborter.abort());

const reflections = createReflectionQueue();
const report = createMemoryReport((line) => console.log(line));
const memoryStore = await openSamplePersonaMemory();
try {
  const persona = createJevPersona({ store: memoryStore });
  const speech = resolveSpeech(persona.voice, process.env);
  if (!speech.ok) {
    console.error(speech.message);
    process.exitCode = 1;
  } else {
    console.log(speech.line);
    process.exitCode = await runLive({
      spawn: spawnProcess,
      microphone: process.argv[2],
      levelDb: level.levelDb,
      signal: aborter.signal,
      createCollaborators: () =>
        createDialogueCollaborators({
          transcriber: createGeminiTranscriber({
            apiKey: geminiApiKey,
          }),
          synthesizer: speech.synthesizer,
          estimator,
          talker: {
            config: createTalkerConfig({
              provider: talkerProvider,
              jsonlPath: runTracePath,
            }),
            store: createMemoryConversationStore(),
            id: "talker",
            persona,
            counterparts: COUNTERPARTS,
            tracePath: outputPath("voice-dialogue-persona-trace.jsonl"),
            reflections,
            onMemory: (memory) => report.memory(memoryLine(memory)),
          },
          worker: {
            config: createWorkerConfig({
              provider,
              estimator,
              jsonlPath: runTracePath,
            }),
            store: createMemoryConversationStore(),
            id: "worker",
          },
        }),
      dialogue: reportingReplies(runDialogue, report),
      openTrace: () =>
        openSessionTrace(
          outputPath("voice-dialogue-trace.jsonl"),
          "voice-dialogue",
        ),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
    });
  }
} finally {
  await reflections.idle();
  report.drain();
  await memoryStore.close();
}
