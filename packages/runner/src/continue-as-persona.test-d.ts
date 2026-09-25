import type { PersonaOutcome } from "./continue-as-persona.js";

declare const outcome: PersonaOutcome<{ token: number }>;

if (outcome.referenced) {
  // @ts-expect-error `expectedRunSessionId` only exists once `referenced` narrows to false
  void outcome.expectedRunSessionId;
} else {
  void outcome.expectedRunSessionId;
}

if (outcome.saved) {
  void outcome.memory;
  void outcome.entry;
} else {
  // @ts-expect-error `memory` only exists once `saved` narrows to true
  void outcome.memory;
  // @ts-expect-error `entry` only exists once `saved` narrows to true
  void outcome.entry;
  void outcome.reason;
}

// @ts-expect-error `memory` needs `saved` narrowed first
export const memoryWithoutNarrowing = outcome.memory;

// @ts-expect-error `reason` only exists once `saved` narrows to false
export const reasonWithoutNarrowing = outcome.reason;
