import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "./types.js";

export const composeGates = (gates: readonly Gate[]): Gate => {
  if (gates.length === 0) {
    throw new RangeError("composeGates needs at least one gate");
  }

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      for (const gate of gates) {
        const verdict = await gate.judge(request, context);
        if (!verdict.allowed) {
          return verdict;
        }
      }

      return {
        allowed: true,
        reason: `All ${gates.length} gates allowed.`,
      };
    },
  };
};
