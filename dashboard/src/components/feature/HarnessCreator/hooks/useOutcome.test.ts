import { describe, expect, it } from "vitest";
import type { createHarnessResponse } from "../../../../api-client/index.js";
import { useOutcome } from "./useOutcome.js";

const headers = new Headers();

const refusal = (
  ...problems: { field: string; message: string }[]
): createHarnessResponse => ({
  status: 422,
  data: { problems },
  headers,
});

describe("useOutcome", () => {
  it("reads a created harness as saved", () => {
    expect(
      useOutcome({ status: 201, data: { id: "a" }, headers }),
    ).toEqual({ kind: "saved" });
  });

  it("names the field of the steps a problem shows at", () => {
    expect(
      useOutcome(
        refusal({ field: "name", message: "この名前は使われています" }),
      ),
    ).toEqual({
      kind: "refused",
      fields: [{ at: "name", message: "この名前は使われています" }],
      others: [],
    });
  });

  it("shows a problem of the model at both fields it is asked at", () => {
    const outcome = useOutcome(
      refusal({ field: "model", message: "モデルがありません" }),
    );

    expect(
      outcome.kind === "refused" && outcome.fields.map((f) => f.at),
    ).toEqual(["model.listed", "model.typed"]);
  });

  it("shows a problem of a rule at the allowed paths", () => {
    const outcome = useOutcome(
      refusal({ field: "rules.0.paths", message: "パスが空です" }),
    );

    expect(outcome.kind === "refused" && outcome.fields).toEqual([
      { at: "paths", message: "パスが空です" },
    ]);
  });

  it("shows a problem of the gate at its question", () => {
    const outcome = useOutcome(
      refusal({
        field: "gateQuestion",
        message: "判定の質問を入力してください",
      }),
    );

    expect(outcome.kind === "refused" && outcome.fields).toEqual([
      { at: "gateQuestion", message: "判定の質問を入力してください" },
    ]);
  });

  it("keeps a problem that no step asks for apart from the fields", () => {
    expect(
      useOutcome(refusal({ field: "form", message: "保存できません" })),
    ).toEqual({
      kind: "refused",
      fields: [],
      others: ["保存できません"],
    });
  });

  it("reads a failed write with its reason", () => {
    expect(
      useOutcome({
        status: 500,
        data: { reason: "disk is full" },
        headers,
      }),
    ).toEqual({ kind: "failed", reason: "disk is full" });
  });
});
