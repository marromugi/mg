import { ExtractorContractError } from "./errors.js";
import type { Counterpart, Extraction } from "./types.js";

const isEmpty = (text: string): boolean => text.trim().length === 0;

export const checkExtraction = (
  extraction: Extraction,
  counterparts: readonly Counterpart[],
): ExtractorContractError | undefined => {
  const knownIds = new Set(
    counterparts.map((counterpart) => counterpart.id),
  );
  const seen = new Set<string>();

  for (const item of extraction.items) {
    if (!knownIds.has(item.counterpart)) {
      return new ExtractorContractError(
        "unknown-counterpart",
        `Counterpart id "${item.counterpart}" is not in the counterpart list.`,
      );
    }

    if (isEmpty(item.text)) {
      return new ExtractorContractError(
        "empty-text",
        `The text for counterpart "${item.counterpart}" is empty.`,
      );
    }

    const key = `${item.counterpart}\u0000${item.text}`;
    if (seen.has(key)) {
      return new ExtractorContractError(
        "duplicate-item",
        `Counterpart "${item.counterpart}" has the same text twice: "${item.text}".`,
      );
    }
    seen.add(key);
  }

  return undefined;
};
