import { describe, expect, it } from "vitest";
import { useToolCard } from "./useToolCard.js";

const READ = {
  kind: "tool",
  id: "1:c1",
  name: "read_file",
  subject: "package.json",
  input: {
    kind: "code",
    language: "json",
    text: '{ "path": "package.json" }',
  },
} as const;

const text = (value: string) =>
  ({ kind: "code", language: "text", text: value }) as const;

describe("useToolCard", () => {
  it("says what a tool is doing while it works", () => {
    expect(useToolCard(READ)).toEqual({
      title: "Read File",
      summary: "package.json を読んでいます…",
      state: "working",
    });
  });

  it("says what a tool did once it gave a result", () => {
    expect(
      useToolCard({
        ...READ,
        result: { shown: text("{}"), refused: false },
      }),
    ).toEqual({
      title: "Read File",
      summary: "package.json を読みました",
      state: "done",
    });
  });

  it("says a refused call was not allowed", () => {
    expect(
      useToolCard({
        ...READ,
        result: { shown: text("no"), refused: true },
      }),
    ).toEqual({
      title: "Read File",
      summary: "package.json は許可されませんでした",
      state: "refused",
    });
  });

  it("names a tool it does not know by the tool alone", () => {
    expect(
      useToolCard({
        kind: "tool",
        id: "1:c1",
        name: "web_search",
        input: text("{}"),
      }),
    ).toEqual({
      title: "web_search",
      summary: "web_search を実行しています…",
      state: "working",
    });
  });
});
