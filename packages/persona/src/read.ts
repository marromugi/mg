import type {
  ConversationSummary,
  MemoryItem,
  PersonaDocument,
} from "@mg/memory";
import type { Counterpart } from "./types.js";

export type RecallRead = {
  counterparts: readonly Counterpart[];
  conversation: string;
  persona: PersonaDocument;
  summary?: ConversationSummary;
  items: MemoryItem[];
  candidates: string[];
  selected: string[];
};
