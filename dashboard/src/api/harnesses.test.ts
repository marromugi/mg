import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import type { DefinitionStore } from "../definition-store/index.js";
import type { Draft } from "../harness-form/index.js";
import { createMemoryStore } from "../test/memory-store.js";

const FILES: Draft = {
  name: "files",
  avatar: "robot-1",
  provider: "openrouter",
  baseUrl: "",
  model: "openai/gpt-4o",
  maxTurns: "10",
  tools: [],
  root: "",
  rules: [],
  judge: false,
  judgeModel: "",
  judgeInstruction: "",
  gate: false,
  gateQuestion: "",
};

const open = (store: DefinitionStore = createMemoryStore()) => {
  const api = createApi({ definitions: store });

  return {
    store,
    create: (body: unknown) =>
      api.request("/harnesses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
  };
};

describe("POST /harnesses", () => {
  it("saves the harness and answers with its id", async () => {
    const dashboard = open();

    const response = await dashboard.create({ draft: FILES });
    const { id } = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    expect(await dashboard.store.get(id)).toMatchObject({
      name: "files",
      avatar: "robot-1",
      harness: { model: "openai/gpt-4o", maxTurns: 10 },
    });
  });

  it("names the field that is wrong and saves nothing", async () => {
    const dashboard = open();

    const response = await dashboard.create({
      draft: { ...FILES, maxTurns: "0" },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      problems: [
        {
          field: "maxTurns",
          message: "1 以上の整数で入力してください",
        },
      ],
    });
    expect((await dashboard.store.list()).definitions).toEqual([]);
  });

  it("refuses a name another harness holds, at the name field", async () => {
    const dashboard = open();
    await dashboard.create({ draft: FILES });

    const response = await dashboard.create({ draft: FILES });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      problems: [
        {
          field: "name",
          message: "この名前は、ほかのエージェントで使われています",
        },
      ],
    });
  });

  it("saves the gate's question with a harness guarded by the gate alone", async () => {
    const dashboard = open();

    const response = await dashboard.create({
      draft: {
        ...FILES,
        tools: ["bash"],
        root: "/work",
        gate: true,
        gateQuestion: "作業フォルダの中だけを変更しますか。",
      },
    });
    const { id } = (await response.json()) as { id: string };

    expect(response.status).toBe(201);
    expect((await dashboard.store.get(id))?.means).toEqual({
      root: "/work",
      tools: ["bash"],
      rules: [],
      gate: { question: "作業フォルダの中だけを変更しますか。" },
    });
  });

  it("names the gate's question when a gate has none", async () => {
    const dashboard = open();

    const response = await dashboard.create({
      draft: { ...FILES, tools: ["bash"], root: "/work", gate: true },
    });

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      problems: [
        {
          field: "gateQuestion",
          message: "判定の質問を入力してください",
        },
      ],
    });
  });

  it("answers with the reason when the write fails", async () => {
    const dashboard = open(
      createMemoryStore({ failWith: "disk is full" }),
    );

    const response = await dashboard.create({ draft: FILES });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ reason: "disk is full" });
  });
});
