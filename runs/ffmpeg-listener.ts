import { createFfmpegKeyListener } from "@mg/voice";
import type { AudioFormat } from "@mg/voice";
import { term } from "@mg/term";
import { spawnProcess } from "./node-spawn.ts";

const format: AudioFormat = {
  encoding: "pcm-s16le",
  sampleRate: 16000,
  channels: 1,
};
const microphone = process.argv[2];
const recordMs = 2000;

async function* presses(): AsyncIterable<void> {
  yield;
  await new Promise<void>((resolve) => setTimeout(resolve, recordMs));
  yield;
}

const controller = new AbortController();
const listener = createFfmpegKeyListener({
  spawn: spawnProcess,
  keys: presses(),
  microphone,
  format,
});

try {
  for await (const utterance of listener.listen(controller.signal)) {
    let chunks = 0;
    for await (const chunk of utterance.audio) {
      if (chunk.data.length > 0) chunks++;
    }
    console.log(term.paint("strong", `chunks: ${chunks}`));
    console.log(
      term.paint(
        "strong",
        `format: ${format.encoding} ${format.sampleRate} Hz ${format.channels} ch`,
      ),
    );
    controller.abort();
  }
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(term.paint("error", `${term.mark.error} ${message}`));
  process.exitCode = 1;
}
