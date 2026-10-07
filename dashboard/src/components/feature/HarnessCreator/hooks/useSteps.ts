import type { HarnessValues } from "../schema.js";

export type StepId = "name" | "model" | "tools" | "security" | "other";

export type Step = {
  id: StepId;
  title: string;
  // The fields the step asks for, checked before moving on from it.
  fields: readonly (keyof HarnessValues)[];
};

const STEPS: readonly Step[] = [
  { id: "name", title: "名前", fields: ["name"] },
  {
    id: "model",
    title: "モデル",
    fields: ["provider", "baseUrl", "model"],
  },
  { id: "tools", title: "ツール", fields: ["tools", "root"] },
  {
    id: "security",
    title: "セキュリティ",
    fields: ["paths", "gate", "gateQuestion"],
  },
  { id: "other", title: "その他", fields: ["maxTurns"] },
];

// The steps to go through, in order. With no tool chosen there is
// nothing to guard, so the security step is left out.
export const useSteps = (toolCount: number): Step[] =>
  STEPS.filter((step) => step.id !== "security" || toolCount > 0);
