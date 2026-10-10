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
import { requireGates } from "./require-gate.js";
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

// What follows a saved reply: the memory outcome, and whether the trace
// was written out. It never rejects.
export type Reflection<TRead> = Promise<{
  memory: MemoryOutcome<TRead>;
  recorded: Recorded;
}>;

export type DetachedPersonaOutcome<TRead> = ContinueOutcome &
  Reference & { personaSessionId: string } & (
    | { saved: true; reflection: Reflection<TRead> }
    | { saved: false; recorded: Recorded }
  );

const shutdown = async (sdk: TraceSdk): Promise<Recorded> => {
  try {
    await sdk.shutdown();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};

type Deps = { continueConversation: ContinueEntry };

const createStart = (deps: Deps) => {
  async function start<TInput, TRead>(
    config: RunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options: ContinueOptions | undefined,
    reflectionSignal: AbortSignal | undefined,
  ): Promise<DetachedPersonaOutcome<TRead>> {
    options?.signal?.throwIfAborted();

    requireGates(config, options?.tools);

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
            const { tools, ...ungated } = withSession;
            if (tools !== undefined) {
              throw new GateRequiredError("added-tools");
            }
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
        saved: false,
        recorded,
      };
    }

    const reflection: Reflection<TRead> = (async () => {
      let memory: MemoryOutcome<TRead>;
      let rememberError: unknown;
      try {
        memory = await persona.persona.remember(
          { read: recall.read, entry: outcome.entry.messages },
          { signal: reflectionSignal, trace: root },
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

      return { memory, recorded: await shutdown(sdk) };
    })();
    return {
      ...outcome,
      ...reference,
      personaSessionId: sdk.sessionId,
      saved: true,
      reflection,
    };
  }
  return start;
};

export const createContinueAsPersona = (deps: Deps) => {
  const start = createStart(deps);

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
    const started = await start(
      config,
      conversation,
      persona,
      options,
      options?.signal,
    );
    if (!started.saved) return started;
    const { reflection, ...rest } = started;
    return { ...rest, ...(await reflection) };
  }

  return continueAsPersona;
};

// Settles when the reply is saved. The reflection runs on after it, and
// does not stop when options.signal fires.
export const createContinueAsPersonaDetached = (deps: Deps) => {
  const start = createStart(deps);

  function continueAsPersonaDetached<TInput, TRead>(
    config: GatedRunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: ContinueOptions,
  ): Promise<DetachedPersonaOutcome<TRead>>;
  function continueAsPersonaDetached<TInput, TRead>(
    config: RunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: UngatedContinueOptions,
  ): Promise<DetachedPersonaOutcome<TRead>>;
  function continueAsPersonaDetached<TInput, TRead>(
    config: RunConfig,
    conversation: ConversationTarget,
    persona: PersonaTarget<TInput, TRead>,
    options?: ContinueOptions,
  ): Promise<DetachedPersonaOutcome<TRead>> {
    return start(config, conversation, persona, options, undefined);
  }

  return continueAsPersonaDetached;
};

export const continueAsPersona = createContinueAsPersona({
  continueConversation,
});

export const continueAsPersonaDetached =
  createContinueAsPersonaDetached({ continueConversation });
