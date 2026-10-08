import { describe, expect, it } from "vitest";
import { emptyValues, type HarnessValues } from "../schema.js";
import { useCreation } from "./useCreation.js";

const values = (over: Partial<HarnessValues>): HarnessValues => ({
  ...emptyValues,
  name: "files",
  model: { custom: false, listed: "openai/gpt-4o", typed: "" },
  ...over,
});

describe("useCreation", () => {
  it("makes a harness with no tools from the first steps alone", () => {
    expect(useCreation(values({}))).toEqual({
      draft: {
        name: "files",
        avatar: "files",
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
        system: "",
        gate: false,
        gateQuestion: "",
      },
    });
  });

  it("takes the typed model when the model is set by hand", () => {
    expect(
      useCreation(
        values({
          model: {
            custom: true,
            listed: "openai/gpt-4o",
            typed: " my/model ",
          },
        }),
      ).draft.model,
    ).toBe("my/model");
  });

  it("takes the typed model and the address for Ollama", () => {
    const { draft } = useCreation(
      values({
        provider: "ollama",
        baseUrl: "http://localhost:11434",
        model: { custom: false, listed: "", typed: "llama3.3" },
      }),
    );
    expect([draft.provider, draft.baseUrl, draft.model]).toEqual([
      "ollama",
      "http://localhost:11434",
      "llama3.3",
    ]);
  });

  it("allows the given paths and refuses the file tools elsewhere", () => {
    expect(
      useCreation(
        values({
          tools: ["read_file", "bash"],
          root: "/work",
          paths: [
            { value: "src/**" },
            { value: "" },
            { value: "docs/**" },
          ],
        }),
      ).draft.rules,
    ).toEqual([
      {
        tools: [],
        paths: "src/**\ndocs/**",
        effect: "allow",
        reason: "",
      },
      {
        tools: ["read_file", "grep", "write_file", "edit_file"],
        paths: "",
        effect: "deny",
        reason: "許可していないパスです",
      },
    ]);
  });

  it("asks for a gate with the question and no rule when only the gate guards", () => {
    const creation = useCreation(
      values({
        tools: ["bash"],
        root: "/work",
        paths: [{ value: "" }],
        gate: true,
        gateQuestion: " この操作は作業フォルダの中だけを変えますか ",
      }),
    );
    expect([
      creation.draft.rules,
      creation.draft.gate,
      creation.draft.gateQuestion,
    ]).toEqual([
      [],
      true,
      "この操作は作業フォルダの中だけを変えますか",
    ]);
  });

  it("drops the folder, paths, and gate when no tool is chosen", () => {
    const creation = useCreation(
      values({
        root: "/work",
        paths: [{ value: "src/**" }],
        gate: true,
        gateQuestion: "x",
      }),
    );
    expect([
      creation.draft.root,
      creation.draft.rules,
      creation.draft.gate,
      creation.draft.gateQuestion,
    ]).toEqual(["", [], false, ""]);
  });

  it("keeps the face that was picked over the one of the name", () => {
    expect(useCreation(values({ avatar: "picked" })).draft.avatar).toBe(
      "picked",
    );
  });
});
