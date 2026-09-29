import { spawn } from "node:child_process";
import { createFfmpegPlayer } from "@mg/voice";
import type { AudioChunk, SpawnProcess } from "@mg/voice";
import { term } from "@mg/term";

const sampleRate = 24000;
const seconds = 1;
const frequency = 440;

const tone = (): AudioChunk => {
  const samples = sampleRate * seconds;
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate);
    data.writeInt16LE(Math.round(value * 0.3 * 32767), i * 2);
  }
  return {
    format: { encoding: "pcm-s16le", sampleRate, channels: 1 },
    data,
  };
};

async function* once(chunk: AudioChunk): AsyncIterable<AudioChunk> {
  yield chunk;
}

const spawnProcess: SpawnProcess = (command, args) => {
  const child = spawn(command, args, {
    stdio: ["pipe", "ignore", "inherit"],
  });
  child.stdin.on("error", () => {});
  const exit = new Promise<number>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? -1));
  });
  return {
    stdin: {
      write: (data) => {
        child.stdin.write(data);
      },
      end: () => {
        child.stdin.end();
      },
    },
    exit,
    kill: () => {
      child.kill();
    },
  };
};

const player = createFfmpegPlayer({ spawn: spawnProcess });

try {
  const end = await player.play(0, once(tone()));
  console.log(term.paint("strong", `played: ${end.played}`));
  if (!end.played) process.exitCode = 1;
} catch (error) {
  const message =
    error instanceof Error ? error.message : String(error);
  console.error(term.paint("error", `${term.mark.error} ${message}`));
  process.exitCode = 1;
}
