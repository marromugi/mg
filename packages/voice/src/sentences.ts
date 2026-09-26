export type Sentence = { text: string; end: number };
export type SplitResult = { sentences: Sentence[]; next: number };

const OPENERS = new Set(["「", "『", "（", "(", "【", "“"]);
const CLOSERS = new Set(["」", "』", "）", ")", "】", "”", "’"]);
const SIMPLE_TERMINATORS = new Set(["。", "！", "？", "!", "?", "\n"]);
const WHITESPACE = /\s/;

function isTerminatorAt(text: string, index: number): boolean {
  const ch = text[index];
  if (ch === undefined) return false;
  if (SIMPLE_TERMINATORS.has(ch)) return true;
  if (ch === ".") {
    const next = text[index + 1];
    return next !== undefined && WHITESPACE.test(next);
  }
  return false;
}

export const splitSentences = (
  text: string,
  from: number,
  final: boolean,
): SplitResult => {
  if (!Number.isInteger(from) || from < 0 || from > text.length) {
    throw new RangeError(
      `from must be an integer from 0 to ${text.length} (text length); got ${from}`,
    );
  }

  const n = text.length;
  const sentences: Sentence[] = [];
  let pos = from;

  while (pos < n) {
    let start = pos;
    while (start < n && WHITESPACE.test(text[start])) start++;

    if (start >= n) {
      pos = start;
      break;
    }

    let depth = 0;
    let i = start;
    let termStart = -1;
    while (i < n) {
      if (depth === 0 && isTerminatorAt(text, i)) {
        termStart = i;
        break;
      }
      const ch = text[i];
      if (OPENERS.has(ch)) {
        depth++;
      } else if (CLOSERS.has(ch)) {
        depth = Math.max(depth - 1, 0);
      }
      i++;
    }

    if (termStart === -1) {
      if (final) {
        let end = n;
        while (end > start && WHITESPACE.test(text[end - 1])) end--;
        sentences.push({ text: text.slice(start, end).trim(), end });
        pos = n;
      } else {
        pos = start;
      }
      break;
    }

    let j = termStart;
    while (j < n && (isTerminatorAt(text, j) || CLOSERS.has(text[j]))) {
      j++;
    }

    if (j === n && !final) {
      pos = start;
      break;
    }

    let end = j;
    while (end > start && WHITESPACE.test(text[end - 1])) end--;

    sentences.push({ text: text.slice(start, j).trim(), end });
    pos = j;
  }

  return { sentences, next: pos };
};
