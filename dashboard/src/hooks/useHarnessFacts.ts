import type { HarnessDefinition } from "../definition/index.js";

export type HarnessFacts = {
  // What the agent's face is drawn from.
  seed: string;
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

// What an agent is, in the words the screens show. An agent saved
// without a face takes the one of its name.
export const useHarnessFacts = (
  definition: HarnessDefinition,
): HarnessFacts => ({
  seed: definition.avatar ?? definition.name,
  provider: PROVIDERS[definition.provider.kind],
  model: definition.harness.model,
  tools: [...(definition.means?.tools ?? [])],
  guards: guardsOf(definition.means),
});
