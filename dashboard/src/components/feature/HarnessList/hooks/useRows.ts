import type { HarnessDefinition } from "../../../../definition/index.js";
import {
  useHarnessFacts,
  type HarnessFacts,
} from "../../../../hooks/useHarnessFacts.js";

export type Row = HarnessFacts & {
  id: string;
  name: string;
  href: string;
};

// One row for each agent, in the order given.
export const useRows = (
  definitions: readonly HarnessDefinition[],
): Row[] =>
  definitions.map((definition) => ({
    id: definition.id,
    name: definition.name,
    href: `/harnesses/${definition.id}`,
    ...useHarnessFacts(definition),
  }));
