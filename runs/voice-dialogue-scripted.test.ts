import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { noopSpan } from "@mg/harness";
import { describe, expect, test, vi } from "vitest";
import type { DialogueCollaborators } from "./voice-dialogue.build.ts";
import { runScripted } from "./voice-dialogue-scripted.ts";

const notCalled = (name: string) => () => {
  throw new Error(`${name} was called`);
};

const collaborators = (
  request: DialogueCollaborators["worker"]["request"],
): DialogueCollaborators => ({
  transcriber: {
    name: "fake",
    accepts: [],
    transcribe: notCalled("transcribe"),
  },
  synthesizer: { name: "fake", synthesize: notCalled("synthesize") },
  judges: {
    stop: { judge: notCalled("stop") },
    redirect: { judge: notCalled("redirect") },
    report: { judge: notCalled("report") },
  },
  workTrigger: { decide: notCalled("workTrigger") },
  talker: { reply: notCalled("reply") },
  worker: {
    request,
    hold: () => {},
    release: () => {},
    wrapUp: () => {},
  },
});

const wav8bit = (): Buffer => {
  const data = Buffer.alloc(1600, 128);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(16000, 28);
  header.writeUInt16LE(1, 32);
  header.writeUInt16LE(8, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
};

const start = async (options: {
  script: (dir: string) => unknown;
  close: () => Promise<void>;
}) => {
  const dir = await mkdtemp(join(tmpdir(), "mg-scripted-"));
  await writeFile(join(dir, "eight.wav"), wav8bit());
  const scriptPath = join(dir, "script.json");
  await writeFile(scriptPath, JSON.stringify(options.script(dir)));
  const request = vi.fn();
  const out: string[] = [];
  const err: string[] = [];
  const code = await runScripted({
    scriptPath,
    collaborators: collaborators(request),
    trace: { span: noopSpan, close: options.close },
    outputDir: join(dir, "out"),
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  });
  return { code, out, err, request, dir };
};

describe("scripted entry", () => {
  test("prints why and exits with code 1 when closing the trace fails", async () => {
    const { code, err } = await start({
      script: () => [],
      close: () => Promise.reject(new Error("disk")),
    });

    expect(code).toBe(1);
    expect(err.some((line) => line.includes("disk"))).toBe(true);
  });

  test("exits with code 1 before any request when a WAV is not 16-bit PCM, naming the file", async () => {
    const { code, err, request, dir } = await start({
      script: (root) => [{ wav: join(root, "eight.wav"), at: 0 }],
      close: async () => {},
    });

    expect(code).toBe(1);
    expect(
      err.some((line) => line.includes(join(dir, "eight.wav"))),
    ).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });
});
