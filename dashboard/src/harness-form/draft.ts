import type { HarnessDefinition } from "../definition/index.js";

// What the editor form holds: every value as the person typed it,
// before it is checked.
export type RuleDraft = {
  tools: string[];
  paths: string;
  effect: string;
  reason: string;
};

export type Draft = {
  name: string;
  avatar: string;
  provider: string;
  baseUrl: string;
  model: string;
  maxTurns: string;
  tools: string[];
  root: string;
  rules: RuleDraft[];
  judge: boolean;
  judgeModel: string;
  judgeInstruction: string;
  gate: boolean;
  gateQuestion: string;
};

export const newRule = (): RuleDraft => ({
  tools: [],
  paths: "",
  effect: "deny",
  reason: "",
});

export const emptyDraft = (): Draft => ({
  name: "",
  avatar: "",
  provider: "openrouter",
  baseUrl: "",
  model: "",
  maxTurns: "",
  tools: [],
  root: "",
  rules: [],
  judge: false,
  judgeModel: "",
  judgeInstruction: "",
  gate: false,
  gateQuestion: "",
});

export const draftFromDefinition = (
  definition: HarnessDefinition,
): Draft => ({
  name: definition.name,
  avatar: definition.avatar ?? "",
  provider: definition.provider.kind,
  baseUrl:
    definition.provider.kind === "ollama"
      ? (definition.provider.baseUrl ?? "")
      : "",
  model: definition.harness.model,
  maxTurns: String(definition.harness.maxTurns),
  tools: [...(definition.means?.tools ?? [])],
  root: definition.means?.root ?? "",
  rules: (definition.means?.rules ?? []).map((rule) => ({
    tools: [...(rule.tools ?? [])],
    paths: (rule.paths ?? []).join("\n"),
    effect: rule.allowed ? "allow" : "deny",
    reason: rule.reason ?? "",
  })),
  judge: definition.means?.judge !== undefined,
  judgeModel: definition.means?.judge?.model ?? "",
  judgeInstruction: definition.means?.judge?.instruction ?? "",
  gate: definition.means?.gate !== undefined,
  gateQuestion: definition.means?.gate?.question ?? "",
});

export const withRuleAdded = (draft: Draft): Draft => ({
  ...draft,
  rules: [...draft.rules, newRule()],
});

export const withRuleRemoved = (
  draft: Draft,
  index: number,
): Draft => ({
  ...draft,
  rules: draft.rules.filter((_, at) => at !== index),
});

const lines = (text: string): string[] =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");

const present = (text: string): string | undefined =>
  text.trim() === "" ? undefined : text.trim();

const allowedOf = (effect: string): boolean | undefined =>
  effect === "allow" ? true : effect === "deny" ? false : undefined;

// The value `parseDefinition` checks. Blank entries are left out, so
// the parser sees them as absent. A harness with no tools has no means.
export const draftToRaw = (draft: Draft, id: string): unknown => ({
  id,
  name: draft.name,
  avatar: present(draft.avatar),
  provider:
    draft.provider === "ollama"
      ? { kind: "ollama", baseUrl: present(draft.baseUrl) }
      : { kind: draft.provider },
  harness: {
    kind: "loop",
    model: draft.model,
    maxTurns:
      present(draft.maxTurns) === undefined
        ? undefined
        : Number(draft.maxTurns),
  },
  means:
    draft.tools.length === 0
      ? undefined
      : {
          root: draft.root,
          tools: draft.tools,
          rules: draft.rules.map((rule) => ({
            tools: rule.tools.length === 0 ? undefined : rule.tools,
            paths:
              lines(rule.paths).length === 0
                ? undefined
                : lines(rule.paths),
            allowed: allowedOf(rule.effect),
            reason: present(rule.reason),
          })),
          judge: draft.judge
            ? {
                model: draft.judgeModel,
                instruction: draft.judgeInstruction,
              }
            : undefined,
          gate: draft.gate
            ? { question: draft.gateQuestion }
            : undefined,
        },
});
