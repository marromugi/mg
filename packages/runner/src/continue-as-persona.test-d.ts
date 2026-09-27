import type { Tool } from "@mg/core";
import type {
  GatedRunConfig,
  RunConfig,
  UngatedRunConfig,
} from "./config.js";
import {
  continueAsPersona,
  type PersonaOutcome,
  type PersonaTarget,
} from "./continue-as-persona.js";
import type {
  ConversationTarget,
  KeepMessages,
} from "./continue-conversation.js";

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

declare const gated: GatedRunConfig;
declare const plain: UngatedRunConfig;
declare const either: RunConfig;
declare const conversation: ConversationTarget;
declare const persona: PersonaTarget<string, { token: number }>;
declare const tool: Tool;
declare const signal: AbortSignal;

export const personaOnGatedWithTools = continueAsPersona(
  gated,
  conversation,
  persona,
  { tools: [tool] },
);

export const personaOnPlainWithTools = continueAsPersona(
  plain,
  conversation,
  persona,
  // @ts-expect-error an ungated config cannot receive tools for the call
  { tools: [tool] },
);

export const personaOnPlainWithSignal = continueAsPersona(
  plain,
  conversation,
  persona,
  { signal },
);

export const personaOnEither = continueAsPersona(
  either,
  conversation,
  persona,
);

export const personaOnEitherWithSignal = continueAsPersona(
  either,
  conversation,
  persona,
  { signal },
);

export const personaOnEitherWithTools = continueAsPersona(
  either,
  conversation,
  persona,
  // @ts-expect-error a run config that might be ungated cannot receive tools for the call
  { tools: [tool] },
);
