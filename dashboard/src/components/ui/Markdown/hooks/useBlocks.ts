import { marked } from "marked";
import { useSettled } from "./useSettled.js";

// The text as its top-level blocks: paragraphs, lists, code, and so
// on, each as the Markdown it was written in. While the text is still
// arriving, the last block is the one that may be unfinished, and it
// comes back as `useSettled` shows it.
export const useBlocks = (
  text: string,
  state: "arriving" | "complete",
): string[] => {
  const blocks = marked
    .lexer(text)
    .filter((token) => token.type !== "space")
    .map((token) => token.raw);
  const last = blocks.at(-1);
  if (state === "complete" || last === undefined) return blocks;

  const settled = useSettled(last);
  return settled === ""
    ? blocks.slice(0, -1)
    : [...blocks.slice(0, -1), settled];
};
