import type { HarnessEvent } from "@mg/harness";
import type { ToolActivity } from "@mg/turn";
import type { WorkStatus } from "./types.js";

export type ToolLog = {
  activity: ToolActivity[];
  add(event: HarnessEvent): void;
};

// Builds the tool activity of one run from its events, oldest first.
export const createToolLog = (): ToolLog => {
  const activity: ToolActivity[] = [];
  const byCall = new Map<string, ToolActivity>();
  return {
    activity,
    add(event) {
      if (event.type === "tool-call") {
        const { id, name, arguments: args } = event.toolCall;
        const entry: ToolActivity = {
          name,
          arguments:
            typeof args === "string"
              ? args
              : (JSON.stringify(args) ?? ""),
          result: null,
        };
        activity.push(entry);
        byCall.set(id, entry);
      } else if (event.type === "tool-result") {
        const entry = byCall.get(event.message.toolCallId);
        if (entry !== undefined) entry.result = event.message.content;
      }
    },
  };
};

export const cutRequest = (
  request: string,
  limit: number,
): { text: string; omitted: number } => {
  const characters = Array.from(request);
  return {
    text: characters.slice(0, limit).join(""),
    omitted: Math.max(0, characters.length - limit),
  };
};

export const buildStatus = (
  work: { request: string; held: boolean; tools: ToolLog } | null,
  latest: WorkStatus["latest"],
  requestLimit: number,
): WorkStatus => {
  if (work === null) {
    return { state: "idle", request: null, tools: [], latest };
  }
  return {
    state: work.held ? "held" : "running",
    request: cutRequest(work.request, requestLimit),
    tools: work.tools.activity.map((tool) => ({ ...tool })),
    latest,
  };
};
