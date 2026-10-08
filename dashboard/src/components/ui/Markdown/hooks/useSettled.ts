// A line that so far holds only the marks a block starts with: a
// heading's, a list item's, a quote's, a fence's, a table's, a rule's.
const ONLY_MARKS = /^[\s#>|*+\-_~`=]*(\d+[.)]?)?\s*$/;

type Open = { mark: string; at: number };

// Where a link stands when the text ends inside it: in its words, just
// after them, or in its address.
type Link = {
  at: number;
  stage: "words" | "closed" | "address";
  end: number;
};

const isSpace = (character: string | undefined): boolean =>
  character === undefined || /\s/.test(character);

const isWord = (character: string | undefined): boolean =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

// The marks a run of one character stands for, outermost first.
const marksOf = (character: string, length: number): string[] => {
  if (character === "~") return length >= 2 ? ["~~"] : [];
  if (length === 1) return [character];
  if (length === 2) return [character.repeat(2)];
  return [character.repeat(2), character];
};

// Inline text whose emphasis, code, and links are still open, closed in
// the order they opened, so each takes its form at once. A mark at the
// very end with nothing to form yet is left out, and so is an image
// that has not fully arrived. A link without its address keeps its
// words and gets an empty address.
const closed = (text: string): string => {
  const open: Open[] = [];
  let code: { at: number; length: number } | undefined;
  let link: Link | undefined;
  let image: number | undefined;
  let cut = text.length;

  for (let index = 0; index < text.length;) {
    const character = text[index] ?? "";
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "`") {
      let length = 1;
      while (text[index + length] === "`") length += 1;
      if (code === undefined) code = { at: index, length };
      else if (code.length === length) code = undefined;
      index += length;
      continue;
    }
    if (code !== undefined || link?.stage === "address") {
      if (character === ")" && code === undefined) {
        link = undefined;
        image = undefined;
      }
      index += 1;
      continue;
    }
    if (character === "[") {
      if (text[index - 1] === "!") image = index - 1;
      link = { at: index, stage: "words", end: index };
      index += 1;
      continue;
    }
    if (character === "]" && link?.stage === "words") {
      const next = text[index + 1];
      if (next === "(") {
        link = { ...link, stage: "address", end: index };
        index += 2;
      } else if (next === undefined) {
        link = { ...link, stage: "closed", end: index };
        index += 1;
      } else {
        link = undefined;
        image = undefined;
        index += 1;
      }
      continue;
    }
    if (character === "*" || character === "_" || character === "~") {
      let length = 1;
      while (text[index + length] === character) length += 1;
      const before = text[index - 1];
      const after = text[index + length];
      const inWord = character === "_";
      const closes = !isSpace(before) && !(inWord && isWord(after));
      const opens = !isSpace(after) && !(inWord && isWord(before));
      const marks = marksOf(character, length);
      if (marks.length === 0 && after === undefined) {
        cut = Math.min(cut, index);
      }
      for (const mark of marks) {
        const held = open.map((entry) => entry.mark).lastIndexOf(mark);
        if (closes && held !== -1) open.length = held;
        else if (opens) open.push({ mark, at: index });
        else if (after === undefined) cut = Math.min(cut, index);
      }
      index += length;
      continue;
    }
    index += 1;
  }

  if (image !== undefined) return closed(text.slice(0, image));

  let body = text.slice(0, cut);
  if (code !== undefined) {
    body =
      code.at + code.length >= body.length
        ? body.slice(0, code.at)
        : body + "`".repeat(code.length);
  }
  const closers = (from: number): string =>
    open
      .filter((entry) => entry.at >= from && entry.at < cut)
      .reverse()
      .map((entry) => entry.mark)
      .join("");

  // A closing mark only closes right after text, never after a space.
  if (link === undefined || link.at >= body.length) {
    return body.trimEnd() + closers(0);
  }
  const words =
    link.stage === "words"
      ? body.slice(link.at + 1)
      : text.slice(link.at + 1, link.end);
  const outside = open
    .filter((entry) => entry.at < link.at)
    .reverse()
    .map((entry) => entry.mark)
    .join("");
  const before = body.slice(0, link.at);
  return words.trim() === ""
    ? before.trimEnd() + outside
    : `${before}[${words.trimEnd()}${closers(link.at)}]()${outside}`;
};

const cellsOf = (line: string): number =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").length;

const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

// Whether the block is the start of a table whose rule line, the one
// that makes it a table, has not fully arrived.
const isTableWithoutRule = (lines: readonly string[]): boolean => {
  const [head, rule, ...rest] = lines;
  if (head === undefined || !head.trimStart().startsWith("|")) {
    return false;
  }
  if (rule === undefined) return true;
  if (rest.length > 0) return false;
  return !TABLE_RULE.test(rule) || cellsOf(rule) !== cellsOf(head);
};

// The last block of text that is still arriving, as it is shown
// meanwhile: marks that are still open are closed, so their text takes
// its form at once, and marks with nothing to form yet are held back
// until what follows them arrives. Nothing of the syntax itself shows.
// An empty result means the whole block is held back.
export const useSettled = (block: string): string => {
  const lines = block.split("\n");
  const [first = ""] = lines;
  const last = lines.at(-1) ?? "";

  // Code: everything is content except a fence that is closing.
  const fence = /^\s*(`{3,}|~{3,})/.exec(first)?.[1];
  if (fence !== undefined) {
    const closing =
      lines.length > 1 && last !== "" && fence.startsWith(last.trim());
    return (closing ? lines.slice(0, -1) : lines).join("\n");
  }

  const table = first.trimStart().startsWith("|");
  if (table && isTableWithoutRule(lines)) return "";

  const kept =
    !table && ONLY_MARKS.test(last) ? lines.slice(0, -1) : lines;
  return closed(kept.join("\n").trimEnd()).trimEnd();
};
