import { readFile } from "node:fs/promises";
import { createLevelListener } from "@mg/voice";
import type { AudioChunk, Microphone } from "@mg/voice";
import { readLevel } from "./level-argument.ts";
import {
  LISTENER_END_MS,
  LISTENER_LEAD_MS,
  LISTENER_LEVEL_DB,
  LISTENER_START_MS,
} from "./voice-dialogue.values.ts";
import { wavChunks } from "./wav.ts";

const usage = 'usage: node runs/level-listener.ts "<wav>" [level]';
const [path, levelArgument, ...extra] = process.argv.slice(2);
const level = readLevel(levelArgument, LISTENER_LEVEL_DB, usage);
if (path === undefined || extra.length > 0 || !level.ok) {
  console.error(usage);
  process.exit(2);
}

try {
  const chunks = wavChunks(path, await readFile(path));
  if (chunks.length === 0) {
    console.log("utterances: 0");
    process.exit(0);
  }
  const whole = Buffer.concat(chunks.map((chunk) => chunk.data));
  const format = chunks[0].format;
  const bytesPerMs = (format.sampleRate * format.channels * 2) / 1000;
  const microphone: Microphone = {
    async *open() {
      yield* chunks;
    },
  };
  const listener = createLevelListener({
    microphone,
    levelDb: level.levelDb,
    startMs: LISTENER_START_MS,
    endMs: LISTENER_END_MS,
    leadMs: LISTENER_LEAD_MS,
  });
  let count = 0;
  let searchFrom = 0;
  for await (const utterance of listener.listen(
    new AbortController().signal,
  )) {
    const parts: AudioChunk[] = [];
    for await (const chunk of utterance.audio) parts.push(chunk);
    const audio = Buffer.concat(parts.map((part) => part.data));
    // An utterance is a contiguous cut of the file, found after the last.
    const at = whole.indexOf(audio, searchFrom);
    searchFrom = at + audio.length;
    count++;
    console.log(
      `utterance ${count}: ${Math.round(at / bytesPerMs)} ms, ${Math.round(audio.length / bytesPerMs)} ms`,
    );
  }
  console.log(`utterances: ${count}`);
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
