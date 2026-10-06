import type { HarnessDefinition } from "../definition/index.js";
import {
  NameTakenError,
  type DefinitionStore,
} from "../definition-store/index.js";

// A store for tests of the pieces above the interface. `failWith`
// makes every put fail with that message.
export const createMemoryStore = (
  options: {
    failWith?: string;
    listFailsWith?: string;
    deleteFailsWith?: string;
  } = {},
): DefinitionStore => {
  const held = new Map<string, HarnessDefinition>();

  return {
    list: () =>
      options.listFailsWith !== undefined
        ? Promise.reject(new Error(options.listFailsWith))
        : Promise.resolve({
            definitions: [...held.values()].sort((first, second) =>
              first.name.localeCompare(second.name),
            ),
            unreadable: [],
          }),
    get: (id) => Promise.resolve(held.get(id)),
    put: (definition) => {
      if (options.failWith !== undefined) {
        return Promise.reject(new Error(options.failWith));
      }
      for (const other of held.values()) {
        if (
          other.id !== definition.id &&
          other.name === definition.name
        ) {
          return Promise.reject(new NameTakenError(definition.name));
        }
      }
      held.set(definition.id, definition);
      return Promise.resolve();
    },
    delete: (id) => {
      if (options.deleteFailsWith !== undefined) {
        return Promise.reject(new Error(options.deleteFailsWith));
      }
      held.delete(id);
      return Promise.resolve();
    },
  };
};
