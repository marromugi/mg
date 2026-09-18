import { describe, expect, it } from "vitest";
import { ATTR, SPAN } from "./vocabulary.js";

describe("SPAN", () => {
  it("names every span with the mg. prefix", () => {
    for (const value of Object.values(SPAN)) {
      expect(value.startsWith("mg.")).toBe(true);
    }
  });

  it("has the harness, llm, tool, run and gate spans", () => {
    expect(SPAN).toEqual({
      harness: "mg.harness",
      llm: "mg.llm",
      tool: "mg.tool",
      run: "mg.run",
      gate: "mg.gate",
    });
  });
});

describe("ATTR", () => {
  it("names every attribute with the mg. prefix", () => {
    for (const value of Object.values(ATTR)) {
      expect(value.startsWith("mg.")).toBe(true);
    }
  });

  it("has the llm attributes used by traceProvider", () => {
    expect(ATTR.op).toBe("mg.op");
    expect(ATTR.llmModel).toBe("mg.llm.model");
    expect(ATTR.llmStream).toBe("mg.llm.stream");
    expect(ATTR.llmFinishReason).toBe("mg.llm.finish_reason");
    expect(ATTR.llmInputTokens).toBe("mg.llm.usage.input_tokens");
    expect(ATTR.llmOutputTokens).toBe("mg.llm.usage.output_tokens");
    expect(ATTR.llmInputMessages).toBe("mg.llm.messages.input");
    expect(ATTR.llmOutputMessages).toBe("mg.llm.messages.output");
  });

  it("has the run attributes", () => {
    expect(ATTR.runName).toBe("mg.run.name");
    expect(ATTR.runCase).toBe("mg.run.case");
  });

  it("has the gate attributes", () => {
    expect(ATTR.gateKind).toBe("mg.gate.kind");
    expect(ATTR.gateDescription).toBe("mg.gate.description");
    expect(ATTR.gateAllowed).toBe("mg.gate.allowed");
    expect(ATTR.gateReason).toBe("mg.gate.reason");
    expect(ATTR.gateModel).toBe("mg.gate.model");
    expect(ATTR.gateProbability).toBe("mg.gate.probability");
  });
});
