import type { Problem } from "../definition/index.js";
import {
  NameTakenError,
  type DefinitionStore,
} from "../definition-store/index.js";
import { parseDefinition } from "../definition-parser/index.js";
import {
  draftToRaw,
  NAME_FIELD,
  toFormProblems,
  type Draft,
} from "../harness-form/index.js";

export type SaveResult =
  | { kind: "saved" }
  | { kind: "refused"; problems: Problem[] }
  | { kind: "failed"; reason: string };

// Checks the draft and, when it makes a valid harness, stores it under
// `id`. Problems come back named by the fields of the form.
export const saveDraft = async (
  store: DefinitionStore,
  id: string,
  draft: Draft,
): Promise<SaveResult> => {
  const parsed = parseDefinition(draftToRaw(draft, id));
  if (!parsed.ok) {
    return {
      kind: "refused",
      problems: toFormProblems(parsed.problems),
    };
  }
  try {
    await store.put(parsed.definition);
  } catch (error) {
    if (error instanceof NameTakenError) {
      return {
        kind: "refused",
        problems: [
          {
            field: NAME_FIELD,
            message: "この名前は、ほかのハーネスで使われています",
          },
        ],
      };
    }
    return {
      kind: "failed",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
  return { kind: "saved" };
};
