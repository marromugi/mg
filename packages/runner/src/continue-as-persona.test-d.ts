import type {
  continueAsPersona,
  PersonaOutcome,
} from "./continue-as-persona.js";
import type { KeepMessages } from "./continue-conversation.js";

declare const outcome: PersonaOutcome<{ token: number }>;

declare const keep: KeepMessages;
type PersonaOptions = Parameters<typeof continueAsPersona>[3];
export const optionsWithKeep: PersonaOptions = { keep };

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
