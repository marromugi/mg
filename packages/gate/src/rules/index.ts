import { realpath } from "node:fs/promises";
import {
  isAbsolute,
  matchesGlob,
  relative as relativePath,
  sep,
} from "node:path";
import type { Reach } from "@mg/core";
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
const UNDECIDED_SENTENCE = "the paths it touches could not be decided.";

const REACH_KIND_TABLE: Record<Reach["kind"], true> = {
  paths: true,
  "any-local": true,
  outside: true,
  none: true,
};
const REACH_KINDS: readonly string[] = Object.keys(REACH_KIND_TABLE);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isReach = (value: unknown): value is Reach =>
  isRecord(value) &&
  typeof value.kind === "string" &&
  REACH_KINDS.includes(value.kind);

const asToolCallPayload = (payload: unknown): ToolCallPayload => {
  const record = isRecord(payload) ? payload : {};
  const { call, reach } = record;

  if (!isRecord(call) || typeof call.name !== "string") {
    throw new GateError("Rules gate payload is missing call");
  }

  if (!isReach(reach)) {
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

const canSplit = (glob: string): boolean => {
  if (
    glob.startsWith("/") ||
    glob.startsWith("./") ||
    glob.endsWith("/") ||
    glob.includes("//") ||
    glob.includes("\\")
  ) {
    return false;
  }

  let depth = 0;
  for (const char of glob) {
    if (char === "{" || char === "(") depth += 1;
    else if (char === "}" || char === ")")
      depth = Math.max(0, depth - 1);
    else if (char === "/" && depth > 0) return false;
  }
  return true;
};

const validateGlobs = (rules: readonly PathRule[]): void => {
  for (const rule of rules) {
    for (const glob of rule.paths ?? []) {
      if (!canSplit(glob)) {
        throw new RangeError(
          `rules gate glob cannot be split into segments: ${glob}`,
        );
      }
    }
  }
};

// Whether some path under `rel` could match the glob: every segment of
// `rel` is consumed by the glob and the glob still has segments left.
const canMatchBelow = (
  relSegments: readonly string[],
  globSegments: readonly string[],
): boolean => {
  const seen = new Map<number, boolean>();
  const walk = (i: number, j: number): boolean => {
    const key = i * (globSegments.length + 1) + j;
    const known = seen.get(key);
    if (known !== undefined) return known;
    const result = step(i, j);
    seen.set(key, result);
    return result;
  };
  const step = (i: number, j: number): boolean => {
    if (i === relSegments.length) return j < globSegments.length;
    if (j === globSegments.length) return false;
    const segment = globSegments[j];
    if (segment === "**") return walk(i + 1, j) || walk(i, j + 1);
    return matchesGlob(relSegments[i], segment) && walk(i + 1, j + 1);
  };
  return walk(0, 0);
};

const locate = (
  root: string,
  target: string,
): { rel: string; outside: boolean } => {
  const relative = relativePath(root, target);
  return {
    rel: (relative === "" ? "." : relative).split(sep).join("/"),
    outside: isOutside(relative),
  };
};

type Hit =
  | { kind: "path"; label: string; outside: boolean }
  | { kind: "undecided" };

const findDenyHit = (
  reach: Reach,
  root: string,
  globs: readonly string[],
): Hit | undefined => {
  if (reach.kind === "any-local") return { kind: "undecided" };
  if (reach.kind !== "paths") return undefined;

  for (const entry of reach.paths) {
    const { rel, outside } = locate(root, entry.path);
    if (outside) {
      return { kind: "path", label: entry.path, outside: true };
    }
    const hit = globs.some(
      (glob) =>
        matchesGlob(rel, glob) ||
        (entry.extent === "tree" &&
          canMatchBelow(
            rel === "." ? [] : rel.split("/"),
            glob.split("/"),
          )),
    );
    if (hit) return { kind: "path", label: rel, outside: false };
  }
  return undefined;
};

const findAllowHit = (
  reach: Reach,
  root: string,
  globs: readonly string[],
): Hit | undefined => {
  if (reach.kind !== "paths" || reach.paths.length === 0) {
    return undefined;
  }

  let first: string | undefined;
  for (const entry of reach.paths) {
    if (entry.extent !== "file") return undefined;
    const { rel, outside } = locate(root, entry.path);
    if (outside) return undefined;
    if (!globs.some((glob) => matchesGlob(rel, glob))) return undefined;
    first ??= rel;
  }
  return { kind: "path", label: first ?? ".", outside: false };
};

export const createRulesGate = (options: RulesGateOptions): Gate => {
  const { root, rules } = options;
  validateGlobs(rules);

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
            const hit = rule.allowed
              ? findAllowHit(reach, realRoot, rule.paths)
              : findDenyHit(reach, realRoot, rule.paths);
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
