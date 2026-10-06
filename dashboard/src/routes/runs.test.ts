import { describe, expect, it } from "vitest";
import type { HarnessDefinition } from "../definition/index.js";
import { createApp } from "../app.js";
import { createSession } from "../session.js";
import {
  createFakeRun,
  finishedResult,
  untilAborted,
} from "../test/fake-run.js";
import { createMemorySecretStore } from "../test/memory-secret-store.js";
import { createMemoryStore } from "../test/memory-store.js";
import { createTestRuns } from "../test-run/index.js";
import type { RunEntry } from "@mg/runner";

const ADDRESS = "127.0.0.1:4100";
const TOKEN = "launch-token";

const OLLAMA_JUDGED: HarnessDefinition = {
  id: "h2",
  name: "judged",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "m", maxTurns: 3 },
  means: {
    root: "/tmp",
    tools: ["read_file"],
    rules: [],
    judge: { model: "m", instruction: "Refuse deletes." },
  },
};

const HARNESS = {
  id: "h1",
  name: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "m", maxTurns: 3 },
} as const;

const open = async (
  run: RunEntry,
  options: { key: boolean; definition?: HarnessDefinition } = {
    key: true,
  },
) => {
  const secrets = createMemorySecretStore();
  if (options.key) await secrets.set("OPENROUTER_API_KEY", "sk-test");
  const definitions = createMemoryStore();
  await definitions.put(HARNESS);
  await definitions.put(options.definition ?? HARNESS);
  const app = createApp({
    session: createSession({ token: TOKEN, address: ADDRESS }),
    dataDir: "/data",
    definitions,
    secrets,
    runs: createTestRuns({ secrets, dataDir: "/data", run }),
  });
  const entered = await app.request(
    `http://${ADDRESS}/enter?token=${TOKEN}`,
    { headers: { Host: ADDRESS } },
  );
  const cookie = (entered.headers.get("Set-Cookie") ?? "").split(
    ";",
  )[0];
  const headers = { Host: ADDRESS, Cookie: cookie ?? "" };

  return {
    get: (path: string) =>
      app.request(`http://${ADDRESS}${path}`, { headers }),
    post: (path: string, input?: string) =>
      app.request(`http://${ADDRESS}${path}`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body:
          input === undefined
            ? ""
            : new URLSearchParams([["input", input]]).toString(),
      }),
  };
};

describe("test runs", () => {
  it("offers an input field and a run button on the harness page", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
    );

    const html = await (await app.get("/harnesses/h1")).text();

    expect(html).toContain('action="/harnesses/h1/runs"');
    expect(html).toContain('name="input"');
    expect(html).toContain("実行する");
  });

  it("shows text, a tool call, its result and the end of a run", async () => {
    const app = await open(
      createFakeRun(({ options }) => {
        options.onEvent?.({
          type: "tool-call",
          toolCall: {
            id: "c1",
            name: "read_file",
            arguments: { path: "note.txt" },
          },
        });
        options.onEvent?.({
          type: "tool-result",
          message: { role: "tool", toolCallId: "c1", content: "blue" },
        });
        options.onEvent?.({ type: "text-delta", delta: "It says " });
        options.onEvent?.({ type: "text-delta", delta: "blue." });
        return Promise.resolve(
          finishedResult("stop", { inputTokens: 40, outputTokens: 7 }),
        );
      }),
    );

    const started = await app.post("/harnesses/h1/runs", "What?");
    expect(started.status).toBe(303);
    const page = await app.get(started.headers.get("Location") ?? "");
    const html = await page.text();

    expect(page.status).toBe(200);
    expect(html).toContain("ツール呼び出し: read_file");
    expect(html).toContain("&quot;path&quot;: &quot;note.txt&quot;");
    expect(html).toContain("ツールの結果");
    expect(html).toContain(
      '<span class="whitespace-pre-wrap">It says </span>',
    );
    expect(html).toContain("終了理由: stop");
    expect(html).toContain("入力トークン: 40");
    expect(html).toContain("出力トークン: 7");
    expect(html).toMatch(
      /トレース: <code[^>]*>\/data\/traces\/[0-9a-f-]+\.jsonl</,
    );
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("names the missing key and links to the API keys page", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
      { key: false },
    );

    const response = await app.post("/harnesses/h1/runs", "hi");
    const html = await response.text();

    expect(response.status).toBe(422);
    expect(html).toContain("OPENROUTER_API_KEY が設定されていません");
    expect(html).toContain('href="/api-keys"');
  });

  it("asks for an input when it is empty", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
    );

    const response = await app.post("/harnesses/h1/runs", "  ");

    expect(response.status).toBe(422);
    expect(await response.text()).toContain("入力を書いてください");
  });

  it("shows the message of a run that failed, and again on reload", async () => {
    const app = await open(
      createFakeRun(() => Promise.reject(new Error("HTTP 401"))),
    );

    const started = await app.post("/harnesses/h1/runs", "hi");
    const location = started.headers.get("Location") ?? "";

    expect(await (await app.get(location)).text()).toContain(
      "実行に失敗しました。HTTP 401",
    );
    expect(await (await app.get(location)).text()).toContain(
      "実行に失敗しました。HTTP 401",
    );
  });

  it("shows no trace path for a run that failed before it ran", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
      { key: true, definition: OLLAMA_JUDGED },
    );

    const started = await app.post("/harnesses/h2/runs", "hi");
    const html = await (
      await app.get(started.headers.get("Location") ?? "")
    ).text();

    expect(html).toContain("実行に失敗しました。判定 LLM は");
    expect(html).toContain("この実行ではトレースを書いていません");
    expect(html).not.toContain("/data/traces");
  });

  it("says a run is gone and names the trace folder after a restart", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
    );

    const response = await app.get("/runs/not-kept");
    const html = await response.text();

    expect(response.status).toBe(404);
    expect(html).toContain("この実行はもう見られません");
    expect(html).toContain("/data/traces");
  });

  it("stops a running run and then says it was stopped", async () => {
    const app = await open(
      createFakeRun(({ options }) => untilAborted(options.signal)),
    );

    const started = await app.post("/harnesses/h1/runs", "count");
    const location = started.headers.get("Location") ?? "";
    const stopped = await app.post(`${location}/stop`);

    expect(stopped.status).toBe(303);
    expect(stopped.headers.get("Location")).toBe(location);
    expect(await (await app.get(location)).text()).toContain(
      "実行を止めました",
    );
  });

  it("says a run that has ended or does not exist cannot be stopped", async () => {
    const app = await open(
      createFakeRun(() => Promise.resolve(finishedResult("stop"))),
    );

    const response = await app.post("/runs/not-kept/stop");

    expect(response.status).toBe(409);
    expect(await response.text()).toContain("止められませんでした");
  });
});
