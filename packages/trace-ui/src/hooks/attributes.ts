import type { SpanRecord } from "@mg/trace/store";

export const attrString = (
  attributes: SpanRecord["attributes"],
  key: string,
): string | undefined => {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
};

export const attrNumber = (
  attributes: SpanRecord["attributes"],
  key: string,
): number | undefined => {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
};
