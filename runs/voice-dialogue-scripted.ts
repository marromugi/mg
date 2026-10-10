import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createMemoryConversationStore } from "@mg/conversation";
import { createOpenRouterProvider } from "@mg/core";
import { runDialogue } from "@mg/dialogue";
import { createGeminiTranscriber } from "@mg/voice";
import { createSampleJevEstimator } from "./jev-estimator.ts";
import { readOneInput } from "./one-input.ts";
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
  createTalkerConfig,
  createWorkerConfig,
  openSessionTrace,
} from "./voice-dialogue.build.ts";
import { runScripted } from "./voice-dialogue-scripted.run.ts";

const read = readOneInput(
  process.argv.slice(2),
  "runs/voice-dialogue-scripted.ts",
);
if (!read.ok) {
  console.error(read.usage);
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

const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
const outputDir = outputPath(`voice-dialogue-scripted-${stamp}`);
const runTracePath = outputPath(
  "voice-dialogue-scripted-run-trace.jsonl",
);

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
    process.exitCode = await runScripted({
      scriptPath: read.input,
      readFile,
      collaborators: {
        transcriber: createGeminiTranscriber({ apiKey: geminiApiKey }),
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
          tracePath: outputPath(
            "voice-dialogue-scripted-persona-trace.jsonl",
          ),
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
      },
      dialogue: reportingReplies(runDialogue, report),
      clock: {
        now: () => performance.now(),
        sleep: (ms, signal) => sleep(ms, undefined, { signal }),
      },
      writeWav: async (name, bytes) => {
        await mkdir(outputDir, { recursive: true });
        await writeFile(join(outputDir, name), bytes);
      },
      outputDir,
      openTrace: () =>
        openSessionTrace(
          outputPath("voice-dialogue-scripted-trace.jsonl"),
          "voice-dialogue-scripted",
        ),
      out: (line) => console.log(line),
      err: (line) => console.error(line),
      signal: aborter.signal,
    });
  }
} finally {
  await reflections.idle();
  report.drain();
  await memoryStore.close();
}
