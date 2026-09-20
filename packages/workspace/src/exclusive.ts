import type { Workspace } from "./types.js";

export const exclusiveNamesOf = (workspace: Workspace): string[] => {
  const names = new Set<string>();
  for (const connector of workspace.connectors) {
    for (const name of connector.exclusive) {
      names.add(name);
    }
  }
  return [...names].sort();
};
