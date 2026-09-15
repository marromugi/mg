import type { HarnessEvent, HarnessResult } from "./types.js";
import { HarnessIncompleteError } from "./errors.js";

export const collect = async (
  events: AsyncIterable<HarnessEvent>,
): Promise<HarnessResult> => {
  for await (const event of events) {
    if (event.type === "done") {
      return event.result;
    }
  }

  throw new HarnessIncompleteError();
};
