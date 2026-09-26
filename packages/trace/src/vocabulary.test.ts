import { describe, expect, it } from "vitest";
import { ATTR, SPAN } from "./vocabulary.js";

describe("SPAN", () => {
  it("names every span with the mg. prefix", () => {
    for (const value of Object.values(SPAN)) {
      expect(value.startsWith("mg.")).toBe(true);
    }
  });

  it("has the harness, llm, tool, run, gate, workspace, subagent, thread, input, trigger, persona, recall and reflection spans", () => {
    expect(SPAN).toEqual({
      harness: "mg.harness",
      llm: "mg.llm",
      tool: "mg.tool",
      run: "mg.run",
      gate: "mg.gate",
      workspace: "mg.workspace",
      subagent: "mg.subagent",
      thread: "mg.thread",
      input: "mg.input",
      trigger: "mg.trigger",
      persona: "mg.persona",
      recall: "mg.recall",
      reflection: "mg.reflection",
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

  it("has the harness stop reason attribute", () => {
    expect(ATTR.harnessStopReason).toBe("mg.harness.stop_reason");
  });

  it("has the run attributes", () => {
    expect(ATTR.runName).toBe("mg.run.name");
    expect(ATTR.runCase).toBe("mg.run.case");
    expect(ATTR.runSession).toBe("mg.run.session");
  });

  it("has the workspace attributes", () => {
    expect(ATTR.workspaceName).toBe("mg.workspace.name");
    expect(ATTR.workspaceConnectors).toBe("mg.workspace.connectors");
    expect(ATTR.workspaceTools).toBe("mg.workspace.tools");
  });

  it("has the gate attributes", () => {
    expect(ATTR.gateKind).toBe("mg.gate.kind");
    expect(ATTR.gateDescription).toBe("mg.gate.description");
    expect(ATTR.gateAllowed).toBe("mg.gate.allowed");
    expect(ATTR.gateReason).toBe("mg.gate.reason");
    expect(ATTR.gateModel).toBe("mg.gate.model");
    expect(ATTR.gateProbability).toBe("mg.gate.probability");
  });

  it("has the subagent and thread attributes", () => {
    expect(ATTR.subagentName).toBe("mg.subagent.name");
    expect(ATTR.subagentCallId).toBe("mg.subagent.call_id");
    expect(ATTR.subagentArguments).toBe("mg.subagent.arguments");
    expect(ATTR.subagentResult).toBe("mg.subagent.result");
    expect(ATTR.threadId).toBe("mg.thread.id");
  });

  it("has the input attributes", () => {
    expect(ATTR.inputValue).toBe("mg.input.value");
  });

  it("has the trigger attributes", () => {
    expect(ATTR.triggerFired).toBe("mg.trigger.fired");
    expect(ATTR.triggerReason).toBe("mg.trigger.reason");
    expect(ATTR.triggerModel).toBe("mg.trigger.model");
    expect(ATTR.triggerProbability).toBe("mg.trigger.probability");
    expect(ATTR.triggerThreshold).toBe("mg.trigger.threshold");
  });

  it("has the persona attributes", () => {
    expect(ATTR.personaId).toBe("mg.persona.id");
    expect(ATTR.personaConversation).toBe("mg.persona.conversation");
    expect(ATTR.personaCounterparts).toBe("mg.persona.counterparts");
    expect(ATTR.personaSaved).toBe("mg.persona.saved");
    expect(ATTR.personaUpdated).toBe("mg.persona.updated");
    expect(ATTR.personaReferenced).toBe("mg.persona.referenced");
  });

  it("has the recall attributes", () => {
    expect(ATTR.recallModel).toBe("mg.recall.model");
    expect(ATTR.recallCandidates).toBe("mg.recall.candidates");
    expect(ATTR.recallSelected).toBe("mg.recall.selected");
    expect(ATTR.recallProbabilities).toBe("mg.recall.probabilities");
  });

  it("has the reflection attributes", () => {
    expect(ATTR.reflectionModel).toBe("mg.reflection.model");
    expect(ATTR.reflectionCandidates).toBe("mg.reflection.candidates");
    expect(ATTR.reflectionKept).toBe("mg.reflection.kept");
    expect(ATTR.reflectionPersonaChanged).toBe(
      "mg.reflection.persona_changed",
    );
    expect(ATTR.reflectionForgotten).toBe("mg.reflection.forgotten");
  });
});
