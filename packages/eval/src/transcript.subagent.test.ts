import { describe, expect, it } from "vitest";
import { transcribe } from "./transcript.js";
import type { RunView, SubagentStep } from "./view.js";

const baseTimes = {
  startTime: "2026-01-01T00:00:00.000Z",
  endTime: "2026-01-01T00:00:01.000Z",
};

const subagentStep: SubagentStep = {
  type: "subagent",
  spanId: "subagent-1",
  ...baseTimes,
  name: "researcher",
  callId: "c1",
  arguments: { prompt: "x" },
  result: "found",
  threadId: "t1",
};

const viewWithSubagentStep = (step: SubagentStep): RunView => ({
  sessionId: "session-1",
  steps: [step],
  llmSteps: [],
  toolSteps: [],
  gateSteps: [],
  subagentSteps: [step],
  turnCount: 0,
  finalText: undefined,
  usage: { inputTokens: 0, outputTokens: 0 },
  ...baseTimes,
});

describe("transcribe with a subagent step", () => {
  it("writes the subagent's result as a labeled block, with no tool block", () => {
    const result = transcribe(viewWithSubagentStep(subagentStep));

    expect(result).toContain("[subagent researcher] found");
    expect(result).not.toContain("[tool researcher]");
  });

  it("truncates the subagent's result to maxToolResultLength with a trailing ellipsis", () => {
    const longResultStep: SubagentStep = {
      ...subagentStep,
      result: "0123456789",
    };

    const result = transcribe(viewWithSubagentStep(longResultStep), {
      maxToolResultLength: 4,
    });

    expect(result).toContain("[subagent researcher] 0123…");
  });

  it("formats a failed subagent step with its error instead of the result", () => {
    const failedStep: SubagentStep = {
      ...subagentStep,
      result: undefined,
      error: "boom",
    };

    const result = transcribe(viewWithSubagentStep(failedStep));

    expect(result).toContain("[subagent researcher error] boom");
  });
});
