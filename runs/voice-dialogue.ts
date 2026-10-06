import { createMemoryConversationStore } from "@mg/conversation";
import { createOpenRouterProvider } from "@mg/core";
import { runDialogue } from "@mg/dialogue";
import {
  createGeminiSynthesizer,
  createGeminiTranscriber,
} from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { spawnProcess } from "./node-spawn.ts";
import { readLevel } from "./level-argument.ts";
import { outputPath } from "./outputs.ts";
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

process.exitCode = await runLive({
  spawn: spawnProcess,
  microphone: process.argv[2],
  levelDb: level.levelDb,
  signal: aborter.signal,
  createCollaborators: () =>
    createDialogueCollaborators({
      transcriber: createGeminiTranscriber({ apiKey: geminiApiKey }),
      synthesizer: createGeminiSynthesizer({
        apiKey: geminiApiKey,
        voice: "Kore",
        language: "ja-JP",
      }),
      estimator,
      talker: {
        config: createTalkerConfig({
          provider: talkerProvider,
          jsonlPath: runTracePath,
        }),
        store: createMemoryConversationStore(),
        id: "talker",
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
  dialogue: runDialogue,
  openTrace: () =>
    openSessionTrace(
      outputPath("voice-dialogue-trace.jsonl"),
      "voice-dialogue",
    ),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
