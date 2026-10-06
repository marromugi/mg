import {
  CredentialDeniedError,
  CredentialStoreError,
} from "./errors.js";
import type {
  CredentialAccess,
  CredentialApproval,
  CredentialEntry,
  CredentialStore,
  CredentialUse,
} from "./types.js";

const isOrigin = (value: string): boolean => {
  try {
    return new URL(value).origin === value;
  } catch {
    return false;
  }
};

const validate = (entries: readonly CredentialEntry[]): void => {
  const names = new Set<string>();
  for (const entry of entries) {
    if (names.has(entry.name)) {
      throw new TypeError(`duplicate login name: ${entry.name}`);
    }
    names.add(entry.name);
    if (entry.fields.length === 0) {
      throw new TypeError(`login ${entry.name} has no fields`);
    }
    for (const origin of entry.origins) {
      if (!isOrigin(origin)) {
        throw new TypeError(
          `login ${entry.name}: ${origin} is not an origin (scheme, host and port only)`,
        );
      }
    }
  }
};

const needsApproval = async (
  approval: CredentialApproval,
  use: CredentialUse,
): Promise<boolean> => {
  if (!approval.needed) return false;
  return approval.needed === true ? true : approval.needed(use);
};

export const createCredentialAccess = (options: {
  store: CredentialStore;
  entries: readonly CredentialEntry[];
  approval: CredentialApproval;
}): CredentialAccess => {
  const { store, entries, approval } = options;
  validate(entries);

  return {
    usableAt(origin) {
      return entries
        .filter((entry) => entry.origins.includes(origin))
        .map((entry) => ({ name: entry.name, fields: entry.fields }));
    },

    async use(use, context) {
      context?.signal?.throwIfAborted();
      const entry = entries.find((e) => e.name === use.name);
      if (entry === undefined) {
        throw new CredentialDeniedError(`unknown login: ${use.name}`);
      }
      if (!entry.fields.includes(use.field)) {
        throw new CredentialDeniedError(
          `unknown field: ${use.name}.${use.field}`,
        );
      }
      if (!entry.origins.includes(use.origin)) {
        throw new CredentialDeniedError(
          `${use.name} is not registered for ${use.origin}`,
        );
      }
      if (
        approval.needed !== false &&
        (await needsApproval(approval, use))
      ) {
        if (!(await approval.ask(use, context))) {
          throw new CredentialDeniedError(
            `approval was refused for ${use.name}.${use.field} on ${use.origin}`,
          );
        }
      }
      context?.signal?.throwIfAborted();
      const value = await store.read(use.name, use.field, context);
      if (value === "") {
        throw new CredentialStoreError(
          `the store gave an empty value for ${use.name}.${use.field}`,
        );
      }
      return value;
    },
  };
};
