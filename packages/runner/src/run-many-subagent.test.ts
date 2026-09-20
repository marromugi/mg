import type { GenerateResponse, Provider } from "@mg/core";
import type { Gate, Verdict } from "@mg/gate";
import type { Connector, Workspace } from "@mg/workspace";
import { defineWorkspace } from "@mg/workspace";
import { describe, expect, test, vi } from "vitest";
import type { RunConfig } from "./config.js";
import type { RunCase } from "./run-many.js";
import { runMany } from "./run-many.js";

const stubGate = (): Gate => ({
  judge: vi.fn(async (): Promise<Verdict> => ({
    allowed: true,
    reason: "ok",
  })),
});

const fakeConnector = (exclusive: readonly string[]): Connector => ({
  kind: "fake",
  exclusive,
  open: async () => ({ tools: [], close: async () => {} }),
});

const fakeWorkspace = (
  exclusive: readonly string[],
  name: string,
): Workspace =>
  defineWorkspace({ name, connectors: [fakeConnector(exclusive)] });

describe("runMany with a subagent's own exclusive workspace", () => {
  test("rejects concurrency 2 with a RangeError naming the subagent's own workspace and its exclusive name, without opening it or calling the provider", async () => {
    const generate = vi.fn(async (): Promise<GenerateResponse> => {
      throw new Error("should not be called");
    });
    const provider: Provider = {
      generate,
      stream: () => {
        throw new Error("stream is not scripted");
      },
    };
    const config: RunConfig = {
      name: "example",
      provider,
      harness: { kind: "loop", model: "m", maxTurns: 1, stream: false },
      subagents: [
        {
          name: "researcher",
          description: "Researches a topic",
          provider,
          harness: {
            kind: "loop",
            model: "m",
            maxTurns: 1,
            stream: false,
          },
          gate: stubGate(),
          workspace: {
            pick: "fixed",
            source: {
              kind: "own",
              workspace: fakeWorkspace(
                ["cdp:localhost:9222"],
                "clean-browser",
              ),
            },
          },
        },
      ],
    };
    const cases: RunCase[] = [
      { id: "a", messages: [{ role: "user", content: "a" }] },
    ];

    const outcome = runMany(config, cases, { concurrency: 2 });

    await expect(outcome).rejects.toBeInstanceOf(RangeError);
    await expect(outcome).rejects.toHaveProperty(
      "message",
      'workspace "clean-browser" holds "cdp:localhost:9222" exclusively; concurrency must be 1, got 2',
    );
    expect(generate).not.toHaveBeenCalled();
  });
});
