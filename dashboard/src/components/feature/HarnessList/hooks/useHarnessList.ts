import type { HarnessDefinition } from "../../../../definition/index.js";

export type HarnessRow = {
  id: string;
  href: string;
  name: string;
  provider: string;
  model: string;
  tools: string;
};

const PROVIDER_LABELS: Record<
  HarnessDefinition["provider"]["kind"],
  string
> = {
  openrouter: "OpenRouter",
  ollama: "Ollama",
};

export const useHarnessList = (
  definitions: readonly HarnessDefinition[],
): HarnessRow[] =>
  definitions.map((definition) => ({
    id: definition.id,
    href: `/harnesses/${definition.id}`,
    name: definition.name,
    provider: PROVIDER_LABELS[definition.provider.kind],
    model: definition.harness.model,
    tools: definition.means?.tools.join("、") ?? "なし",
  }));
