import { formatBytes, type BoundedOutput } from "./bounded-output.js";

/** The last line of a result that was cut; `undefined` when nothing was. */
export const closingLine = (
  report: BoundedOutput,
): string | undefined => {
  if (report.savedPath === undefined) return undefined;
  const shown = formatBytes(Buffer.byteLength(report.text));
  const total = formatBytes(report.totalBytes);
  const { from, to } = report.shownLines;
  if (report.partialLine) {
    const side = report.keep === "end" ? "last" : "first";
    return (
      `[showing the ${side} ${shown} of line ${from} ` +
      `(line is ${formatBytes(report.partialLineBytes)}; ${total} in all). ` +
      `Full output: ${report.savedPath}]`
    );
  }
  return (
    `[showing lines ${from}-${to} ` +
    `of ${report.totalLines} (${shown} of ${total}). ` +
    `Full output: ${report.savedPath}]`
  );
};
