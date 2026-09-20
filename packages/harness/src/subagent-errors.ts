import type { ToolSchema } from "@mg/core";

type ValidateResult = Awaited<
  ReturnType<ToolSchema["~standard"]["validate"]>
>;

export class SubagentNotFoundError extends Error {
  override readonly name = "SubagentNotFoundError";
  readonly callId: string;
  readonly subagentName: string;

  constructor(callId: string, subagentName: string) {
    super(`No subagent named ${subagentName} for call ${callId}`);
    this.callId = callId;
    this.subagentName = subagentName;
  }
}

export class SubagentInputError extends Error {
  override readonly name = "SubagentInputError";
  readonly callId: string;
  readonly subagentName: string;
  readonly issues: NonNullable<ValidateResult["issues"]>;

  constructor(
    callId: string,
    subagentName: string,
    issues: NonNullable<ValidateResult["issues"]>,
  ) {
    super(
      `Invalid arguments for subagent call ${callId} (${subagentName})`,
    );
    this.callId = callId;
    this.subagentName = subagentName;
    this.issues = issues;
  }
}
