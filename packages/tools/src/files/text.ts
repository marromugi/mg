export const splitLines = (text: string): string[] => {
  if (text === "") return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
};

export const isBinary = (text: string): boolean => text.includes("\0");

export const sliceCodePoints = (
  line: string,
  startCol: number,
  endCol?: number,
): string => {
  const chars = Array.from(line);
  const start = Math.max(0, startCol - 1);
  const end =
    endCol === undefined ? chars.length : Math.max(0, endCol - 1);
  return chars.slice(start, end).join("");
};
