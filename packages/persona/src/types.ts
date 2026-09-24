import type { Message } from "@mg/core";
import type { TraceSpan } from "@mg/harness";

export type Counterpart = { id: string; name: string };

export type PersonaContext = {
  signal?: AbortSignal;
  trace?: TraceSpan;
};

export type RecallRequest<TInput> = {
  counterparts: readonly Counterpart[];
  conversation: string;
  input: TInput;
};

export type Recall<TRead> = { instruction: string; read: TRead };

export type RememberRequest<TRead> = {
  read: TRead;
  entry: readonly Message[];
};

export type RememberOutcome<TRead> =
  | {
      updated: true;
      added: string[];
      personaChanged: boolean;
      forgotten: string[];
    }
  | {
      updated: false;
      reason: "undecided";
      error: unknown;
      request: RememberRequest<TRead>;
    }
  | { updated: false; reason: "write-failed"; error: unknown }
  | {
      updated: false;
      reason: "forget-failed";
      error: unknown;
      added: string[];
      personaChanged: boolean;
      pending: string[];
    };

export interface Persona<TInput, TRead> {
  readonly id: string;
  recall(
    request: RecallRequest<TInput>,
    context?: PersonaContext,
  ): Promise<Recall<TRead>>;
  remember(
    request: RememberRequest<TRead>,
    context?: PersonaContext,
  ): Promise<RememberOutcome<TRead>>;
}

type CounterpartText = { counterpart: string; text: string };

export type ExtractorInput = {
  counterparts: readonly Counterpart[];
  entry: readonly Message[];
  memory: {
    persona: string;
    items: readonly CounterpartText[];
    summary?: string;
  };
};

export type Extraction = {
  summary: string;
  items: readonly CounterpartText[];
  persona?: string;
};

export interface Extractor {
  extract(
    input: ExtractorInput,
    context?: PersonaContext,
  ): Promise<Extraction>;
}
