import {
  MemoryArgumentError,
  MemoryConflictError,
  MemoryItemExistsError,
  MemoryItemNotFoundError,
  PersonaExistsError,
  PersonaNotFoundError,
  type MemoryConflictMismatch,
} from "./errors.js";
import type {
  MemoryChange,
  MemoryItem,
  MemorySelection,
  MemoryStore,
  MemoryView,
  MissCounts,
  NewMemoryItem,
} from "./types.js";

type StoredItem = {
  id: string;
  counterpart: string;
  text: string;
  createdAt: number;
  misses: number;
  seq: number;
};

type StoredPersona = {
  persona: { text: string; version: number };
  summaries: Map<string, { text: string; version: number }>;
  items: Map<string, StoredItem>;
  nextSeq: number;
};

const isEmpty = (value: string): boolean => value.trim().length === 0;

const isNonNegativeInteger = (value: number): boolean =>
  Number.isInteger(value) && value >= 0;

const findDuplicate = (ids: readonly string[]): string | undefined => {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      return id;
    }
    seen.add(id);
  }
  return undefined;
};

const isEmptyChange = (change: MemoryChange): boolean =>
  change.persona === undefined &&
  change.summary === undefined &&
  (change.add === undefined || change.add.length === 0) &&
  (change.hits === undefined || change.hits.length === 0) &&
  (change.misses === undefined || change.misses.length === 0);

const validateSelection = (selection: MemorySelection): void => {
  const duplicate = findDuplicate(selection.counterparts);
  if (duplicate !== undefined) {
    throw new MemoryArgumentError(
      "duplicate-id",
      `Counterpart id "${duplicate}" appears more than once.`,
    );
  }
  for (const counterpart of selection.counterparts) {
    if (isEmpty(counterpart)) {
      throw new MemoryArgumentError(
        "empty-id",
        "A counterpart id must not be empty.",
      );
    }
  }
  if (
    selection.conversation !== undefined &&
    isEmpty(selection.conversation)
  ) {
    throw new MemoryArgumentError(
      "empty-id",
      "The conversation id must not be empty.",
    );
  }
};

const validateNewItem = (item: NewMemoryItem): void => {
  if (isEmpty(item.id)) {
    throw new MemoryArgumentError(
      "empty-id",
      "An item id must not be empty.",
    );
  }
  if (isEmpty(item.counterpart)) {
    throw new MemoryArgumentError(
      "empty-id",
      "An item's counterpart id must not be empty.",
    );
  }
  if (isEmpty(item.text)) {
    throw new MemoryArgumentError(
      "empty-text",
      "An item's text must not be empty.",
    );
  }
  if (!Number.isFinite(item.createdAt)) {
    throw new MemoryArgumentError(
      "invalid-time",
      "An item's createdAt must be a finite number.",
    );
  }
};

const validateChange = (change: MemoryChange): void => {
  if (isEmptyChange(change)) {
    throw new MemoryArgumentError(
      "empty-change",
      "The change must set at least one field.",
    );
  }

  if (change.persona !== undefined) {
    if (isEmpty(change.persona.text)) {
      throw new MemoryArgumentError(
        "empty-text",
        "The persona's text must not be empty.",
      );
    }
    if (!isNonNegativeInteger(change.persona.expectedVersion)) {
      throw new MemoryArgumentError(
        "invalid-version",
        "The persona's expectedVersion must be a non-negative integer.",
      );
    }
  }

  if (change.summary !== undefined) {
    if (isEmpty(change.summary.conversation)) {
      throw new MemoryArgumentError(
        "empty-id",
        "The summary's conversation id must not be empty.",
      );
    }
    if (isEmpty(change.summary.text)) {
      throw new MemoryArgumentError(
        "empty-text",
        "The summary's text must not be empty.",
      );
    }
    if (!isNonNegativeInteger(change.summary.expectedVersion)) {
      throw new MemoryArgumentError(
        "invalid-version",
        "The summary's expectedVersion must be a non-negative integer.",
      );
    }
  }

  if (change.add !== undefined) {
    for (const item of change.add) {
      validateNewItem(item);
    }
    const duplicate = findDuplicate(change.add.map((item) => item.id));
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in add.`,
      );
    }
  }

  if (change.hits !== undefined) {
    for (const id of change.hits) {
      if (isEmpty(id)) {
        throw new MemoryArgumentError(
          "empty-id",
          "An item id must not be empty.",
        );
      }
    }
    const duplicate = findDuplicate(change.hits);
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in hits.`,
      );
    }
  }

  if (change.misses !== undefined) {
    for (const id of change.misses) {
      if (isEmpty(id)) {
        throw new MemoryArgumentError(
          "empty-id",
          "An item id must not be empty.",
        );
      }
    }
    const duplicate = findDuplicate(change.misses);
    if (duplicate !== undefined) {
      throw new MemoryArgumentError(
        "duplicate-id",
        `Item id "${duplicate}" appears more than once in misses.`,
      );
    }
  }

  if (change.hits !== undefined && change.misses !== undefined) {
    const misses = new Set(change.misses);
    const overlap = change.hits.find((id) => misses.has(id));
    if (overlap !== undefined) {
      throw new MemoryArgumentError(
        "hit-and-miss",
        `Item id "${overlap}" is both hit and missed.`,
      );
    }
  }
};

const validateDeleteIds = (itemIds: readonly string[]): void => {
  if (itemIds.length === 0) {
    throw new MemoryArgumentError(
      "empty-list",
      "The list of item ids to delete must not be empty.",
    );
  }
  for (const id of itemIds) {
    if (isEmpty(id)) {
      throw new MemoryArgumentError(
        "empty-id",
        "An item id must not be empty.",
      );
    }
  }
  const duplicate = findDuplicate(itemIds);
  if (duplicate !== undefined) {
    throw new MemoryArgumentError(
      "duplicate-id",
      `Item id "${duplicate}" appears more than once.`,
    );
  }
};

const toMemoryItem = (item: StoredItem): MemoryItem => ({
  id: item.id,
  counterpart: item.counterpart,
  text: item.text,
  createdAt: item.createdAt,
  misses: item.misses,
});

export const createMemoryStore = (): MemoryStore => {
  const personas = new Map<string, StoredPersona>();

  const requirePersona = (personaId: string): StoredPersona => {
    const found = personas.get(personaId);
    if (found === undefined) {
      throw new PersonaNotFoundError(personaId);
    }
    return found;
  };

  const create = async (
    personaId: string,
    personaText: string,
  ): Promise<void> => {
    if (isEmpty(personaId)) {
      throw new MemoryArgumentError(
        "empty-id",
        "The persona id must not be empty.",
      );
    }
    if (isEmpty(personaText)) {
      throw new MemoryArgumentError(
        "empty-text",
        "The persona's text must not be empty.",
      );
    }
    if (personas.has(personaId)) {
      throw new PersonaExistsError(personaId);
    }
    personas.set(personaId, {
      persona: { text: personaText, version: 1 },
      summaries: new Map(),
      items: new Map(),
      nextSeq: 0,
    });
  };

  const read = async (
    personaId: string,
    selection: MemorySelection,
  ): Promise<MemoryView> => {
    const stored = requirePersona(personaId);
    validateSelection(selection);

    const counterparts = new Set(selection.counterparts);
    const items = [...stored.items.values()]
      .filter((item) => counterparts.has(item.counterpart))
      .sort((a, b) => {
        if (a.createdAt !== b.createdAt) {
          return b.createdAt - a.createdAt;
        }
        return b.seq - a.seq;
      })
      .map(toMemoryItem);

    const summary =
      selection.conversation === undefined
        ? undefined
        : stored.summaries.get(selection.conversation);

    return {
      persona: { ...stored.persona },
      items,
      ...(summary === undefined ? {} : { summary: { ...summary } }),
    };
  };

  const write = async (
    personaId: string,
    change: MemoryChange,
  ): Promise<MissCounts> => {
    const stored = requirePersona(personaId);
    validateChange(change);

    const mismatches: MemoryConflictMismatch[] = [];
    if (
      change.persona !== undefined &&
      change.persona.expectedVersion !== stored.persona.version
    ) {
      mismatches.push({
        kind: "persona",
        expectedVersion: change.persona.expectedVersion,
        actualVersion: stored.persona.version,
      });
    }
    if (change.summary !== undefined) {
      const actualVersion =
        stored.summaries.get(change.summary.conversation)?.version ?? 0;
      if (change.summary.expectedVersion !== actualVersion) {
        mismatches.push({
          kind: "summary",
          key: change.summary.conversation,
          expectedVersion: change.summary.expectedVersion,
          actualVersion,
        });
      }
    }
    if (mismatches.length > 0) {
      throw new MemoryConflictError(personaId, mismatches);
    }

    if (change.add !== undefined) {
      const existingIds = change.add
        .map((item) => item.id)
        .filter((id) => stored.items.has(id));
      if (existingIds.length > 0) {
        throw new MemoryItemExistsError(personaId, existingIds);
      }
    }

    const missingIds = [
      ...(change.hits ?? []).filter((id) => !stored.items.has(id)),
      ...(change.misses ?? []).filter((id) => !stored.items.has(id)),
    ];
    if (missingIds.length > 0) {
      throw new MemoryItemNotFoundError(personaId, missingIds);
    }

    if (change.persona !== undefined) {
      stored.persona = {
        text: change.persona.text,
        version: stored.persona.version + 1,
      };
    }

    if (change.summary !== undefined) {
      const actualVersion =
        stored.summaries.get(change.summary.conversation)?.version ?? 0;
      stored.summaries.set(change.summary.conversation, {
        text: change.summary.text,
        version: actualVersion + 1,
      });
    }

    if (change.add !== undefined) {
      for (const item of change.add) {
        stored.items.set(item.id, {
          id: item.id,
          counterpart: item.counterpart,
          text: item.text,
          createdAt: item.createdAt,
          misses: 0,
          seq: stored.nextSeq++,
        });
      }
    }

    for (const id of change.hits ?? []) {
      const item = stored.items.get(id);
      if (item !== undefined) {
        item.misses = 0;
      }
    }

    const missCounts: [string, number][] = [];
    for (const id of change.misses ?? []) {
      const item = stored.items.get(id);
      if (item !== undefined) {
        item.misses += 1;
        missCounts.push([id, item.misses]);
      }
    }

    return Object.fromEntries(missCounts);
  };

  const deleteItems = async (
    personaId: string,
    itemIds: readonly string[],
  ): Promise<void> => {
    const stored = requirePersona(personaId);
    validateDeleteIds(itemIds);

    const missingIds = itemIds.filter((id) => !stored.items.has(id));
    if (missingIds.length > 0) {
      throw new MemoryItemNotFoundError(personaId, missingIds);
    }

    for (const id of itemIds) {
      stored.items.delete(id);
    }
  };

  return { create, read, write, delete: deleteItems };
};
