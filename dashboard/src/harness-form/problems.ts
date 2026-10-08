import type { Problem } from "../definition/index.js";

export const NAME_FIELD = "name";

// A problem that belongs to no field of the form.
export const FORM_FIELD = "form";

const FIXED: Record<string, string> = {
  name: "name",
  avatar: "avatar",
  "provider.kind": "provider",
  "provider.baseUrl": "baseUrl",
  "harness.model": "model",
  "harness.maxTurns": "maxTurns",
  system: "system",
  "means.root": "root",
  "means.tools": "tools",
  "means.rules": "rules",
  "means.judge.model": "judgeModel",
  "means.judge.instruction": "judgeInstruction",
  "means.gate.question": "gateQuestion",
};

const RULE_FIELDS: Record<string, string> = {
  tools: "tools",
  paths: "paths",
  allowed: "effect",
  reason: "reason",
};

// Names the field of the form a problem of the definition shows at.
export const toFormField = (field: string): string => {
  const fixed = FIXED[field];
  if (fixed !== undefined) return fixed;
  const rule = /^means\.rules\.(\d+)\.(\w+)$/.exec(field);
  const ruleField =
    rule?.[2] === undefined ? undefined : RULE_FIELDS[rule[2]];
  return rule?.[1] === undefined || ruleField === undefined
    ? FORM_FIELD
    : `rules.${rule[1]}.${ruleField}`;
};

export const toFormProblems = (
  problems: readonly Problem[],
): Problem[] =>
  problems.map((problem) => ({
    field: toFormField(problem.field),
    message: problem.message,
  }));
