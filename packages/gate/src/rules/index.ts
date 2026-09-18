import {
  matchesGlob,
  relative as relativePath,
  resolve as resolvePath,
  sep,
} from "node:path";
import { GateError } from "../errors.js";
import { TOOL_CALL_KIND, type ToolCallPayload } from "../tool-gate.js";
import { withGateSpan } from "../trace.js";
import type {
  Gate,
  GateContext,
  GateRequest,
  Verdict,
} from "../types.js";

export type PathRule = {
  tools?: readonly string[];
  paths?: readonly string[];
  allowed: boolean;
  reason?: string;
};

export type RulesGateOptions = {
  root: string;
  rules: readonly PathRule[];
};

const NOT_TOOL_CALL_REASON = "No rule applies to this request.";
const NO_RULE_REASON = "No rule matched.";

const asToolCallPayload = (payload: unknown): ToolCallPayload => {
  const call =
    typeof payload === "object" && payload !== null
      ? (payload as { call?: unknown }).call
      : undefined;

  if (
    typeof call !== "object" ||
    call === null ||
    typeof (call as { name?: unknown }).name !== "string"
  ) {
    throw new GateError("Rules gate payload is missing call");
  }

  return payload as ToolCallPayload;
};

const pathArgument = (
  call: ToolCallPayload["call"],
): string | undefined => {
  const args = call.arguments;
  if (typeof args !== "object" || args === null) return undefined;
  const value = (args as Record<string, unknown>).path;
  return typeof value === "string" ? value : undefined;
};

const toRelative = (root: string, target: string): string => {
  const absolute = resolvePath(root, target);
  const rel = relativePath(root, absolute);
  return (rel === "" ? "." : rel).split(sep).join("/");
};

export const createRulesGate = (options: RulesGateOptions): Gate => {
  const { root, rules } = options;

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      return withGateSpan(context, request, {}, async () => {
        if (request.kind !== TOOL_CALL_KIND) {
          return { allowed: true, reason: NOT_TOOL_CALL_REASON };
        }

        const { call } = asToolCallPayload(request.payload);
        const argument = pathArgument(call);
        const relative =
          argument === undefined
            ? undefined
            : toRelative(root, argument);

        for (const [index, rule] of rules.entries()) {
          if (
            rule.tools !== undefined &&
            !rule.tools.includes(call.name)
          ) {
            continue;
          }

          if (rule.paths !== undefined) {
            if (relative === undefined) continue;
            const matched = rule.paths.some((glob) =>
              matchesGlob(relative, glob),
            );
            if (!matched) continue;
          }

          const reason =
            rule.reason ??
            `Rule ${index} ${
              rule.allowed ? "allowed" : "denied"
            } ${call.name} on ${relative}`;
          return { allowed: rule.allowed, reason };
        }

        return { allowed: true, reason: NO_RULE_REASON };
      });
    },
  };
};
