import type { Message } from "@mg/core";
import type {
  Counterpart,
  Persona,
  Recall,
  RememberOutcome,
} from "@mg/persona";
import {
  ATTR,
  setSpanAttributes,
  SPAN,
  startRootSpan,
} from "@mg/trace";
import { createTraceSdk, type TraceSdk } from "@mg/trace/otel";
import { nanoid } from "nanoid";
import type { GatedRunConfig, RunConfig } from "./config.js";
import type {
  ContinueEntry,
  ContinueOptions,
  ContinueOutcome,
  ConversationTarget,
  UngatedContinueOptions,
} from "./continue-conversation.js";
import { continueConversation } from "./continue-conversation.js";
import { GateRequiredError } from "./errors.js";
import type { RecordTraceOptions } from "./record-trace.js";

export type PersonaTarget<TInput, TRead> = {
  persona: Persona<TInput, TRead>;
  counterparts: readonly Counterpart[];
  input: TInput;
  trace: RecordTraceOptions;
};

export type Recorded = { ok: true } | { ok: false; error: unknown };

export type Reference =
  | { referenced: true }
  | { referenced: false; expectedRunSessionId: string };

export type MemoryOutcome<TRead> =
  | RememberOutcome<TRead>
  | { updated: false; reason: "rejected"; error: unknown };

export type PersonaOutcome<TRead> = ContinueOutcome &
  Reference & { personaSessionId: string; recorded: Recorded } & (
    { saved: true; memory: MemoryOutcome<TRead> } | { saved: false }
  );

const shutdown = async (sdk: TraceSdk): Promise<Recorded> => {
  try {
    await sdk.shutdown();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

export const createContinueAsPersona = (deps: {
  continueConversation: ContinueEntry;
}) => {
  function continueAsPersona<TInput, TRead>(
    config: GatedRunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: ContinueOptions,
  ): Promise<PersonaOutcome<TRead>>;
  function continueAsPersona<TInput, TRead>(
    config: RunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: UngatedContinueOptions,
  ): Promise<PersonaOutcome<TRead>>;
  async function continueAsPersona<TInput, TRead>(
    config: RunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: ContinueOptions,
  ): Promise<PersonaOutcome<TRead>> {
    options?.signal?.throwIfAborted();

    if (config.gate === undefined) {
      if (
        config.tools !== undefined ||
        config.workspace !== undefined
      ) {
        throw new GateRequiredError("means");
      }
      if (options?.tools !== undefined) {
        throw new GateRequiredError("added-tools");
      }
    }

    const sdk = await createTraceSdk(persona.trace);
    const root = startRootSpan(sdk.tracer, SPAN.persona, {
      [ATTR.op]: "persona",
      [ATTR.personaId]: persona.persona.id,
      [ATTR.personaConversation]: conversation.id,
      [ATTR.personaCounterparts]: JSON.stringify(
        persona.counterparts.map((counterpart) => counterpart.id),
      ),
    });

    const runSessionId = options?.sessionId ?? nanoid();
    setSpanAttributes(root, { [ATTR.runSession]: runSessionId });

    let recall: Recall<TRead>;
    try {
      recall = await persona.persona.recall(
        {
          counterparts: persona.counterparts,
          conversation: conversation.id,
          input: persona.input,
        },
        { signal: options?.signal, trace: root },
      );
    } catch (error) {
      root.end(error);
      try {
        await sdk.shutdown();
      } catch {
        // The recall failure wins over a shutdown failure that follows it.
      }
      throw error;
    }

    const instructionMessage: Message = {
      role: "system",
      content: recall.instruction,
    };

    const withInstruction: ConversationTarget = {
      ...conversation,
      messages: [instructionMessage, ...conversation.messages],
    };
    const withSession: ContinueOptions = {
      ...options,
      sessionId: runSessionId,
    };

    let outcome: ContinueOutcome;
    try {
      outcome = await (config.gate !== undefined
        ? deps.continueConversation(
            config,
            withInstruction,
            withSession,
          )
        : (() => {
            const { tools: _tools, ...ungated } = withSession;
            return deps.continueConversation(
              config,
              withInstruction,
              ungated,
            );
          })());
    } catch (error) {
      root.end(error);
      try {
        await sdk.shutdown();
      } catch {
        // The run failure wins over a shutdown failure that follows it.
      }
      throw error;
    }

    const reference: Reference =
      outcome.sessionId === runSessionId
        ? { referenced: true }
        : { referenced: false, expectedRunSessionId: runSessionId };
    setSpanAttributes(root, {
      [ATTR.personaReferenced]: reference.referenced,
    });

    if (!outcome.saved) {
      setSpanAttributes(root, { [ATTR.personaSaved]: false });
      root.end();
      const recorded = await shutdown(sdk);
      return {
        ...outcome,
        ...reference,
        personaSessionId: sdk.sessionId,
        recorded,
      };
    }

    let memory: MemoryOutcome<TRead>;
    let rememberError: unknown;
    try {
      memory = await persona.persona.remember(
        { read: recall.read, entry: outcome.entry.messages },
        { signal: options?.signal, trace: root },
      );
    } catch (error) {
      memory = { updated: false, reason: "rejected", error };
      rememberError = error;
    }

    setSpanAttributes(root, {
      [ATTR.personaSaved]: true,
      [ATTR.personaUpdated]: memory.updated,
    });
    root.end(rememberError);

    const recorded = await shutdown(sdk);
    return {
      ...outcome,
      ...reference,
      personaSessionId: sdk.sessionId,
      recorded,
      memory,
    };
  }

  return continueAsPersona;
};

export const continueAsPersona = createContinueAsPersona({
  continueConversation,
});
