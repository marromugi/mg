import type { Problem } from "../../../../definition/index.js";
import { FORM_FIELD } from "../../../../harness-form/index.js";

export type HarnessEditorView = {
  errorOf: (field: string) => string | undefined;
  // Messages that belong to no field.
  general: string[];
};

export const useHarnessEditor = (
  problems: readonly Problem[],
): HarnessEditorView => ({
  errorOf: (field) =>
    problems.find((problem) => problem.field === field)?.message,
  general: problems
    .filter((problem) => problem.field === FORM_FIELD)
    .map((problem) => problem.message),
});
