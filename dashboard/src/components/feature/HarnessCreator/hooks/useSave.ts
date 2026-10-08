import { useCreateHarness } from "../../../../api-client/index.js";
import type { Creation } from "./useCreation.js";
import { useOutcome, type Outcome } from "./useOutcome.js";

const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

// Saves what the steps asked for through the API. A request that gets
// no answer ends as a failure with its reason.
export const useSave = (): ((
  creation: Creation,
) => Promise<Outcome>) => {
  const { mutateAsync } = useCreateHarness();

  return async (creation) => {
    try {
      return useOutcome(await mutateAsync({ data: creation }));
    } catch (error) {
      return { kind: "failed", reason: reasonOf(error) };
    }
  };
};
