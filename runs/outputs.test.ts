import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@mg/core";
import type { HarnessConfig, RunConfig } from "@mg/runner";
import { startRootSpan } from "@mg/trace";
import { createTraceSdk } from "@mg/trace/otel";
import { beforeAll, describe, expect, test } from "vitest";
import { outputPath, traceReaderFor } from "./outputs.ts";

const OUTPUT_NAMES = [
  "trace.jsonl",
  "trigger-trace.jsonl",
  "persona-trace.jsonl",
  "turn-trace.jsonl",
  "persona-memory.sqlite",
  "persona-conversation.sqlite",
];

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const fakeProvider: Provider = {
  toolForcing: true,
  generate: () => Promise.reject(new Error("not used")),
  stream: () => {
    throw new Error("not used");
  },
};

const baseConfig: { provider: Provider; harness: HarnessConfig } = {
  provider: fakeProvider,
  harness: { kind: "loop", model: "m", maxTurns: 1 },
};

describe("outputPath", () => {
  test("resolves each name to an absolute path under the repository's .mg directory", () => {
    for (const name of OUTPUT_NAMES) {
      expect(outputPath(name)).toBe(join(repoRoot, ".mg", name));
    }
  });

  test("resolves to the same paths when run from another directory", () => {
    const before = OUTPUT_NAMES.map((name) => outputPath(name));
    const originalCwd = process.cwd();
    process.chdir(tmpdir());
    try {
      const after = OUTPUT_NAMES.map((name) => outputPath(name));
      expect(after).toEqual(before);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("the six loop configs' trace destination", () => {
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), "mg-outputs-test-"));
    const sshKeyPath = join(dir, "id_ed25519");
    writeFileSync(sshKeyPath, "placeholder");

    process.env.OPENROUTER_API_KEY = "placeholder";
    process.env.TYPESAFE_API_KEY = "placeholder";
    process.env.OLLAMA_API_KEY = "placeholder";
    process.env.MG_SSH_HOST = "placeholder";
    process.env.MG_SSH_USER = "placeholder";
    process.env.MG_SSH_KEY_PATH = sshKeyPath;
    process.env.MG_CDP_PORT = "9333";
    process.env.MG_CLEAN_CDP_PORT = "9334";
  });

  const configNames = [
    "loop-bash-gate",
    "loop-bash-jev-gate",
    "loop-files",
    "loop-search",
    "loop-subagent",
    "loop-workspace",
  ];

  test.each(configNames)(
    "%s.config.ts writes its trace to the shared trace.jsonl path",
    async (name) => {
      const module: { default: RunConfig } = await import(
        `./${name}.config.ts`
      );
      expect(module.default.trace?.jsonlPath).toBe(
        outputPath("trace.jsonl"),
      );
    },
  );
});

describe("traceReaderFor", () => {
  test("reads a session written to the config's own trace destination", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-outputs-test-"));
    const jsonlPath = join(dir, "trace.jsonl");

    const sdk = await createTraceSdk({ jsonlPath, sessionId: "s-1" });
    const root = startRootSpan(sdk.tracer, "test");
    root.end();
    await sdk.shutdown();

    const reader = traceReaderFor({
      ...baseConfig,
      name: "with-trace",
      trace: { jsonlPath },
    });

    const session = await reader.readSession("s-1");
    expect(session).toBeDefined();
  });

  test("finds no session when the config points at a different trace file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mg-outputs-test-"));
    const emptyJsonlPath = join(dir, "trace.jsonl");

    const reader = traceReaderFor({
      ...baseConfig,
      name: "with-other-trace",
      trace: { jsonlPath: emptyJsonlPath },
    });

    const session = await reader.readSession("s-1");
    expect(session).toBeUndefined();
  });

  test("throws naming the config when the config has no trace destination", () => {
    expect(() =>
      traceReaderFor({
        ...baseConfig,
        name: "no-trace",
      }),
    ).toThrowError("no-trace: trace.jsonlPath is not set");
  });
});
