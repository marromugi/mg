import type { ToolInputIssue } from "@mg/core";

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
  readonly issues: readonly ToolInputIssue[];

  constructor(
    callId: string,
    subagentName: string,
    issues: readonly ToolInputIssue[],
  ) {
    super(
      `Invalid arguments for subagent call ${callId} (${subagentName})`,
    );
    this.callId = callId;
    this.subagentName = subagentName;
    this.issues = issues;
  }
}
