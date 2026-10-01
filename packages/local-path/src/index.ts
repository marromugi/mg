import path from "node:path";
import type { AbsolutePath } from "@mg/core";

export type PathRules = Pick<
  typeof path,
  "isAbsolute" | "parse" | "sep"
>;

// Absolute means independent of the working directory and, on Windows,
// of the current drive.
export const isAbsolutePath = (
  value: string,
  rules: PathRules = path,
): value is AbsolutePath => {
  if (!rules.isAbsolute(value)) return false;
  if (rules.sep !== "\\") return true;
  const { root } = rules.parse(value);
  return /^[A-Za-z]:[\\/]/.test(root) || /^[\\/]{2}/.test(root);
};

export const toAbsolutePath = (
  value: string,
  rules: PathRules = path,
): AbsolutePath => {
  if (!isAbsolutePath(value, rules)) {
    throw new RangeError(
      `not an absolute path: ${JSON.stringify(value)}`,
    );
  }
  return value;
};
