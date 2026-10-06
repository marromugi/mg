import type { SecretName, SecretStore } from "../secret-store/index.js";

// A store for tests of the pieces above the interface. Each `...FailsWith`
// makes that operation fail with the message.
export const createMemorySecretStore = (
  options: {
    hasFailsWith?: string;
    setFailsWith?: string;
    deleteFailsWith?: string;
  } = {},
): SecretStore & { peek(name: SecretName): string | undefined } => {
  const held = new Map<SecretName, string>();

  return {
    has: (name) =>
      options.hasFailsWith !== undefined
        ? Promise.reject(new Error(options.hasFailsWith))
        : Promise.resolve(held.has(name)),
    get: (name) => Promise.resolve(held.get(name)),
    set: (name, value) => {
      if (options.setFailsWith !== undefined) {
        return Promise.reject(new Error(options.setFailsWith));
      }
      held.set(name, value);
      return Promise.resolve();
    },
    delete: (name) => {
      if (options.deleteFailsWith !== undefined) {
        return Promise.reject(new Error(options.deleteFailsWith));
      }
      held.delete(name);
      return Promise.resolve();
    },
    peek: (name) => held.get(name),
  };
};
