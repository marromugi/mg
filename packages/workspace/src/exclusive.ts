import { DuplicateExclusiveNameError } from "./errors.js";
import type { Workspace } from "./types.js";

export const exclusiveNamesOf = (workspace: Workspace): string[] => {
  const holdersByName = new Map<
    string,
    { kind: string; index: number }[]
  >();
  workspace.connectors.forEach((connector, index) => {
    for (const name of new Set(connector.exclusive)) {
      const holders = holdersByName.get(name) ?? [];
      holders.push({ kind: connector.kind, index });
      holdersByName.set(name, holders);
    }
  });

  const names = [...holdersByName.keys()].sort();
  for (const name of names) {
    const holders = holdersByName.get(name) ?? [];
    if (holders.length > 1) {
      throw new DuplicateExclusiveNameError(
        workspace.name,
        name,
        holders,
      );
    }
  }
  return names;
};
