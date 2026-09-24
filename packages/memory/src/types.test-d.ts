import { MemoryArgumentError } from "./errors.js";
import type {
  MemoryChange,
  MemoryItem,
  MemorySelection,
} from "./types.js";

// @ts-expect-error a memory item needs a miss count
export const itemWithoutMisses: MemoryItem = {
  id: "i1",
  counterpart: "jev",
  text: "likes tea",
  createdAt: 0,
};

export const selectionWithoutConversation: MemorySelection = {
  counterparts: ["jev"],
};

export const emptyChange: MemoryChange = {};

export const argumentErrorName: "MemoryArgumentError" =
  new MemoryArgumentError("empty-id", "x").name;
