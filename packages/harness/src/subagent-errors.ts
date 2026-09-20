import type { StandardSchemaV1 } from "@standard-schema/spec";

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
  readonly issues: readonly StandardSchemaV1.Issue[];

  constructor(
    callId: string,
    subagentName: string,
    issues: readonly StandardSchemaV1.Issue[],
  ) {
    super(
      `Invalid arguments for subagent call ${callId} (${subagentName})`,
    );
    this.callId = callId;
    this.subagentName = subagentName;
    this.issues = issues;
  }
}
