import { newRule, type Draft, type RuleDraft } from "./draft.js";

export type Intent =
  | { kind: "save" }
  | { kind: "add-rule" }
  | { kind: "remove-rule"; index: number };

export type Submission = { draft: Draft; intent: Intent };

type Body = Record<string, unknown>;

const all = (body: Body, key: string): string[] => {
  const value = body[key];
  const entries = Array.isArray(value) ? value : [value];
  return entries.filter((entry) => typeof entry === "string");
};

const one = (body: Body, key: string): string =>
  all(body, key)[0] ?? "";

const readIntent = (value: string): Intent | undefined => {
  if (value === "" || value === "save") return { kind: "save" };
  if (value === "add-rule") return { kind: "add-rule" };
  const removed = /^remove-rule:(\d+)$/.exec(value);
  return removed?.[1] === undefined
    ? undefined
    : { kind: "remove-rule", index: Number(removed[1]) };
};

// The fields of the rule rows are named `rules.<row>.<field>`.
const ruleRows = (body: Body): number[] => {
  const rows = new Set<number>();
  for (const key of Object.keys(body)) {
    const row = /^rules\.(\d+)\./.exec(key)?.[1];
    if (row !== undefined) rows.add(Number(row));
  }
  return [...rows].sort((first, second) => first - second);
};

const readRule = (body: Body, row: number): RuleDraft => ({
  ...newRule(),
  tools: all(body, `rules.${row}.tools`),
  paths: one(body, `rules.${row}.paths`),
  effect: one(body, `rules.${row}.effect`),
  reason: one(body, `rules.${row}.reason`),
});

// Undefined when the button that sent the form is not one the editor
// draws.
export const readSubmission = (body: Body): Submission | undefined => {
  const intent = readIntent(one(body, "intent"));
  if (intent === undefined) return undefined;
  return {
    intent,
    draft: {
      name: one(body, "name"),
      avatar: one(body, "avatar"),
      provider: one(body, "provider"),
      baseUrl: one(body, "baseUrl"),
      model: one(body, "model"),
      maxTurns: one(body, "maxTurns"),
      system: one(body, "system"),
      tools: all(body, "tools"),
      root: one(body, "root"),
      rules: ruleRows(body).map((row) => readRule(body, row)),
      judge: one(body, "judge") === "on",
      judgeModel: one(body, "judgeModel"),
      judgeInstruction: one(body, "judgeInstruction"),
      gate: one(body, "gate") === "on",
      gateQuestion: one(body, "gateQuestion"),
    },
  };
};
