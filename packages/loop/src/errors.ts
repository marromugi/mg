import type { ToolPairingProblem } from "@mg/core";

export class MessageListError extends Error {
  override readonly name = "MessageListError";
  readonly kind: ToolPairingProblem["kind"];
  readonly toolCallId: string;
  readonly turn: number;

  constructor(problem: ToolPairingProblem, turn: number) {
    const { kind, toolCallId } = problem;
    super(
      kind === "duplicate-call"
        ? `Tool call "${toolCallId}" appears more than once in the messages for turn ${turn}.`
        : kind === "orphan-result"
          ? `Tool result "${toolCallId}" has no tool call before it in the messages for turn ${turn}.`
          : `Tool call "${toolCallId}" has no tool result after it in the messages for turn ${turn}.`,
    );
    this.kind = kind;
    this.toolCallId = toolCallId;
    this.turn = turn;
  }
}

export class StreamIncompleteError extends Error {
  override readonly name = "StreamIncompleteError";

  constructor() {
    super("Provider stream ended without a finish event");
  }
}

export class DuplicateCallableNameError extends Error {
  override readonly name = "DuplicateCallableNameError";

  constructor(name: string) {
    super(`Name "${name}" is used by more than one tool or subagent`);
  }
}

export class GateRequiredError extends Error {
  override readonly name = "GateRequiredError";

  constructor() {
    super("gate is required when tools are set");
  }
}
