import { describe, expect, it } from "vitest";
import { presentCall } from "./shown.js";

describe("presentCall", () => {
  it("shows a read file in the language of its name, with its line numbers apart", () => {
    const call = presentCall("read_file", { path: "src/app.ts" });

    expect(call.subject).toBe("src/app.ts");
    expect(call.result("3\tconst a = 1;\n4\tconst b = 2;")).toEqual({
      kind: "code",
      language: "typescript",
      startLine: 3,
      text: "const a = 1;\nconst b = 2;",
    });
  });

  it("shows a read result that is not numbered lines as it is", () => {
    const call = presentCall("read_file", { path: "src/app.ts" });

    expect(call.result("1\tconst a = 1;\n[output truncated]")).toEqual({
      kind: "code",
      language: "text",
      text: "1\tconst a = 1;\n[output truncated]",
    });
  });

  it("shows the command of a shell call as shell code", () => {
    expect(presentCall("bash", { command: "ls -la" }).input).toEqual({
      kind: "code",
      language: "shellscript",
      text: "ls -la",
    });
  });

  it("shows what a file is written with in the language of its name", () => {
    expect(
      presentCall("write_file", { path: "a.json", content: "{}" })
        .input,
    ).toEqual({ kind: "code", language: "json", text: "{}" });
  });

  it("shows a tool it does not know as JSON in and plain text out", () => {
    const call = presentCall("web_search", { query: "mg" });

    expect(call.subject).toBeUndefined();
    expect(call.input).toEqual({
      kind: "code",
      language: "json",
      text: '{\n  "query": "mg"\n}',
    });
    expect(call.result("found")).toEqual({
      kind: "code",
      language: "text",
      text: "found",
    });
  });
});
