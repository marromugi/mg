import type { MemoryItem } from "@mg/memory";
import type { RecallHeadings } from "./recall.js";
import type { RecallRead } from "./read.js";

export const composeInstruction = (
  read: RecallRead,
  headings: RecallHeadings,
): string => {
  const itemsById = new Map(
    read.items.map((item): [string, MemoryItem] => [item.id, item]),
  );
  const selectedItems = read.selected
    .map((id) => itemsById.get(id))
    .filter((item): item is MemoryItem => item !== undefined);

  const blocks: string[] = [read.persona.text];

  for (const counterpart of read.counterparts) {
    const lines = selectedItems
      .filter((item) => item.counterpart === counterpart.id)
      .map((item) => `- ${item.text}`);

    if (lines.length > 0) {
      blocks.push(
        `${headings.about} ${counterpart.name}\n${lines.join("\n")}`,
      );
    }
  }

  if (read.summary !== undefined) {
    blocks.push(`${headings.earlier}\n${read.summary.text}`);
  }

  return blocks.join("\n\n");
};
