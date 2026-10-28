import {
  TOOL_CALL_KIND,
  type Gate,
  type ToolCallPayload,
} from "@mg/gate";
import { LATER_TOOL } from "./later.js";

export const LATER_ONLY_REASON =
  "only the later tool is allowed on the host";

/** Allows the `later` tool and refuses every other call. */
export const createLaterOnlyGate = (
  onRefuse?: (tool: string | undefined) => void,
): Gate => ({
  judge: async (request) => {
    const tool =
      request.kind === TOOL_CALL_KIND
        ? (request.payload as ToolCallPayload).call.name
        : undefined;
    if (tool === LATER_TOOL) {
      return { allowed: true, reason: "the later tool is allowed" };
    }
    onRefuse?.(tool);
    return { allowed: false, reason: LATER_ONLY_REASON };
  },
});
