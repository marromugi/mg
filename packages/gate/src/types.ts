export type GateRequest = {
  kind: string;
  description: string;
  payload?: unknown;
};

export type Verdict = { allowed: boolean; reason: string };

export type GateContext = { signal?: AbortSignal };

export interface Gate {
  judge(request: GateRequest, context?: GateContext): Promise<Verdict>;
}
