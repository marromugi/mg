export type PersonaDocument = {
  text: string;
  version: number;
};

export type ConversationSummary = {
  text: string;
  version: number;
};

export type MemoryItem = {
  id: string;
  counterpart: string;
  text: string;
  createdAt: number;
  misses: number;
};

export type MemorySelection = {
  counterparts: readonly string[];
  conversation?: string;
};

export type MemoryView = {
  persona: PersonaDocument;
  items: MemoryItem[];
  summary?: ConversationSummary;
};

export type NewMemoryItem = {
  id: string;
  counterpart: string;
  text: string;
  createdAt: number;
};

export type MemoryChange = {
  persona?: { text: string; expectedVersion: number };
  summary?: {
    conversation: string;
    text: string;
    expectedVersion: number;
  };
  add?: readonly NewMemoryItem[];
  hits?: readonly string[];
  misses?: readonly string[];
};

export type MissCounts = Record<string, number>;

export interface MemoryStore {
  create(personaId: string, personaText: string): Promise<void>;
  read(
    personaId: string,
    selection: MemorySelection,
  ): Promise<MemoryView>;
  write(personaId: string, change: MemoryChange): Promise<MissCounts>;
  delete(personaId: string, itemIds: readonly string[]): Promise<void>;
}
