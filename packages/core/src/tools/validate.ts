import type { ToolInput, ToolInputIssue, ToolSchema } from "./types.js";

export const validateToolInput = async <TSchema extends ToolSchema>(
  schema: TSchema,
  value: unknown,
): Promise<
  | { ok: true; value: ToolInput<TSchema> }
  | { ok: false; issues: readonly ToolInputIssue[] }
> => {
  const result = await schema["~standard"].validate(value);
  if (result.issues) {
    return { ok: false, issues: result.issues };
  }
  return { ok: true, value: result.value };
};
