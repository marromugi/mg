import { useSaveHarnessPrompt } from "../../../../api-client/index.js";
import type { SaveOutcome } from "../HarnessView.js";

// Saves the agent's system prompt through the API. A request that gets
// no answer ends as a failure with its reason.
export const useSavePrompt = (
  harnessId: string,
): ((system: string) => Promise<SaveOutcome>) => {
  const { mutateAsync } = useSaveHarnessPrompt();

  return async (system) => {
    try {
      const response = await mutateAsync({
        id: harnessId,
        data: { system },
      });
      return response.status === 200
        ? { kind: "saved" }
        : { kind: "failed", reason: response.data.reason };
    } catch (error) {
      return {
        kind: "failed",
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  };
};
