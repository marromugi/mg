import type { HarnessDefinition } from "../definition/index.js";

export interface DefinitionStore {
  // Definitions sorted by name. `unreadable` holds the names of stored
  // files that could not be read as a definition.
  list(): Promise<{
    definitions: HarnessDefinition[];
    unreadable: string[];
  }>;
  // Undefined when no definition has this id, or its file is unreadable.
  get(id: string): Promise<HarnessDefinition | undefined>;
  // Throws NameTakenError when another id holds the name.
  put(definition: HarnessDefinition): Promise<void>;
  // Deleting an id that does not exist succeeds.
  delete(id: string): Promise<void>;
}
