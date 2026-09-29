import { realpath } from "node:fs/promises";
import {
  isAbsolute,
  matchesGlob,
  relative as relativePath,
  sep,
} from "node:path";
import type { Reach, ReachPath } from "@mg/core";
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

const REACH_KINDS: readonly string[] = [
  "paths",
  "any-local",
  "outside",
  "none",
];

const asToolCallPayload = (payload: unknown): ToolCallPayload => {
  const record =
    typeof payload === "object" && payload !== null
      ? (payload as { call?: unknown; reach?: unknown })
      : {};
  const { call, reach } = record;

  if (
    typeof call !== "object" ||
    call === null ||
    typeof (call as { name?: unknown }).name !== "string"
  ) {
    throw new GateError("Rules gate payload is missing call");
  }

  if (
    typeof reach !== "object" ||
    reach === null ||
    !REACH_KINDS.includes((reach as { kind?: unknown }).kind as string)
  ) {
    throw new GateError("Rules gate payload is missing reach");
  }

  return payload as ToolCallPayload;
};

const resolveRoot = async (root: string): Promise<string> => {
  try {
    return await realpath(root);
  } catch {
    throw new GateError(`cannot resolve the rules gate root: ${root}`);
  }
};

const isOutside = (relative: string): boolean =>
  isAbsolute(relative) ||
  relative === ".." ||
  relative.startsWith(`..${sep}`);

// Whether some path under `rel` could match the glob: every segment of
// `rel` is consumed by the glob and the glob still has segments left.
const canMatchBelow = (
  relSegments: readonly string[],
  globSegments: readonly string[],
): boolean => {
  const walk = (i: number, j: number): boolean => {
    if (i === relSegments.length) return j < globSegments.length;
    if (j === globSegments.length) return false;
    const segment = globSegments[j];
    if (segment === "**") return walk(i + 1, j) || walk(i, j + 1);
    return matchesGlob(relSegments[i], segment) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
};

const hitsGlob = (entry: ReachPath, rel: string, glob: string) =>
  matchesGlob(rel, glob) ||
  (entry.extent === "tree" &&
    canMatchBelow(rel === "." ? [] : rel.split("/"), glob.split("/")));

type Hit =
  | { kind: "path"; label: string; outside: boolean }
  | { kind: "undecided" };

const findHit = (
  reach: Reach,
  root: string,
  globs: readonly string[],
): Hit | undefined => {
  if (reach.kind === "any-local") return { kind: "undecided" };
  if (reach.kind !== "paths") return undefined;

  for (const entry of reach.paths) {
    const relative = relativePath(root, entry.path);
    if (isOutside(relative)) {
      return { kind: "path", label: entry.path, outside: true };
    }
    const rel = (relative === "" ? "." : relative).split(sep).join("/");
    if (globs.some((glob) => hitsGlob(entry, rel, glob))) {
      return { kind: "path", label: rel, outside: false };
    }
  }
  return undefined;
};

const UNDECIDED_SENTENCE = "the paths it touches could not be decided.";

export const createRulesGate = (options: RulesGateOptions): Gate => {
  const { root, rules } = options;

  return {
    async judge(
      request: GateRequest,
      context?: GateContext,
    ): Promise<Verdict> {
      context?.signal?.throwIfAborted();

      return withGateSpan(context, request, {}, async () => {
        if (request.kind !== TOOL_CALL_KIND) {
          return { allowed: true, reason: NOT_TOOL_CALL_REASON };
        }

        const { call, reach } = asToolCallPayload(request.payload);
        const realRoot = await resolveRoot(root);

        for (const [index, rule] of rules.entries()) {
          if (
            rule.tools !== undefined &&
            !rule.tools.includes(call.name)
          ) {
            continue;
          }

          const verb = rule.allowed ? "allowed" : "denied";
          const prefix = `Rule ${index} ${verb} ${call.name}`;
          let defaultReason = prefix;
          let undecided = false;

          if (rule.paths !== undefined) {
            const hit = findHit(reach, realRoot, rule.paths);
            if (hit === undefined) continue;
            if (hit.kind === "undecided") {
              undecided = true;
              defaultReason = `${prefix}: ${UNDECIDED_SENTENCE}`;
            } else {
              defaultReason = hit.outside
                ? `${prefix} on ${hit.label} (outside the root)`
                : `${prefix} on ${hit.label}`;
            }
          }

          const reason =
            rule.reason === undefined
              ? defaultReason
              : undecided
                ? `${defaultReason} ${rule.reason}`
                : rule.reason;
          return { allowed: rule.allowed, reason };
        }

        return { allowed: true, reason: NO_RULE_REASON };
      });
    },
  };
};
