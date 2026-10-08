import { describe, expect, it } from "vitest";
import { parseDefinition } from "./parse.js";

const valid = {
  id: "abc",
  name: "files",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "m", maxTurns: 10 },
  means: {
    root: "/work",
    tools: ["read_file"],
    rules: [{ paths: [".env"], allowed: false }],
  },
};

describe("parseDefinition", () => {
  it("accepts a harness with tools and a rule", () => {
    expect(parseDefinition(valid)).toEqual({
      ok: true,
      definition: valid,
    });
  });

  it("accepts a harness with no tools and no means", () => {
    const bare = {
      id: valid.id,
      name: valid.name,
      provider: valid.provider,
      harness: valid.harness,
    };

    expect(parseDefinition(bare)).toEqual({
      ok: true,
      definition: bare,
    });
  });

  it("accepts tools with no rules when a judge is set", () => {
    const judged = {
      ...valid,
      means: {
        ...valid.means,
        rules: [],
        judge: { model: "j", instruction: "Refuse deletes." },
      },
    };

    expect(parseDefinition(judged)).toEqual({
      ok: true,
      definition: judged,
    });
  });

  it("accepts tools with no rules when a gate is set", () => {
    const gated = {
      ...valid,
      means: {
        ...valid.means,
        rules: [],
        gate: { question: "Does this stay inside the folder?" },
      },
    };

    expect(parseDefinition(gated)).toEqual({
      ok: true,
      definition: gated,
    });
  });

  it("refuses a gate with no question", () => {
    expect(
      parseDefinition({
        ...valid,
        means: { ...valid.means, gate: { question: " " } },
      }),
    ).toEqual({
      ok: false,
      problems: [
        {
          field: "means.gate.question",
          message: "判定の質問を入力してください",
        },
      ],
    });
  });

  it("refuses tools with neither a rule nor a judge", () => {
    const result = parseDefinition({
      ...valid,
      means: { ...valid.means, rules: [] },
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        {
          field: "means.rules",
          message:
            "ツールを使うエージェントには、パスのルール、判定 LLM、ゲートのどれかが要ります",
        },
      ],
    });
  });

  it("names every wrong field", () => {
    const result = parseDefinition({
      id: "abc",
      name: " ",
      provider: { kind: "ollama", baseUrl: "not a url" },
      harness: { kind: "loop", model: "m", maxTurns: 1.5 },
      means: {
        root: "relative/dir",
        tools: ["delete_everything"],
        rules: [{ tools: [], allowed: "yes" }],
      },
    });

    expect(result).toEqual({
      ok: false,
      problems: [
        { field: "name", message: "名前を入力してください" },
        {
          field: "provider.baseUrl",
          message: "http か https のアドレスを書いてください",
        },
        {
          field: "harness.maxTurns",
          message: "1 以上の整数で入力してください",
        },
        { field: "means.root", message: "絶対パスで書いてください" },
        {
          field: "means.tools",
          message: "使えるツールの名前を 1 つ以上選んでください",
        },
        {
          field: "means.rules.0.tools",
          message: "使えるツールの名前を 1 つ以上選んでください",
        },
        {
          field: "means.rules.0.allowed",
          message: "許可か拒否を選んでください",
        },
      ],
    });
  });
});
