import type { HarnessDefinition } from "../../../../definition/index.js";

export type Row = {
  id: string;
  name: string;
  // What the agent's face is drawn from.
  seed: string;
  href: string;
  provider: string;
  model: string;
  tools: string[];
  // How the tools are guarded, one word for each guard in use.
  guards: string[];
};

const PROVIDERS: Record<HarnessDefinition["provider"]["kind"], string> =
  { openrouter: "OpenRouter", ollama: "Ollama" };

const guardsOf = (means: HarnessDefinition["means"]): string[] => [
  ...((means?.rules.length ?? 0) > 0 ? ["パス"] : []),
  ...(means?.judge === undefined ? [] : ["判定 LLM"]),
  ...(means?.gate === undefined ? [] : ["ゲート"]),
];

// One row for each agent, in the order given. An agent saved without a
// face takes the one of its name.
export const useRows = (
  definitions: readonly HarnessDefinition[],
): Row[] =>
  definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    seed: definition.avatar ?? definition.name,
    href: `/harnesses/${definition.id}`,
    provider: PROVIDERS[definition.provider.kind],
    model: definition.harness.model,
    tools: [...(definition.means?.tools ?? [])],
    guards: guardsOf(definition.means),
  }));
