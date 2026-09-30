import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type { ToolDefinition } from "../providers/types.js";

export type ToolSchema = StandardSchemaV1 & StandardJSONSchemaV1;

export type ToolInput<TSchema extends ToolSchema> =
  StandardSchemaV1.InferOutput<TSchema>;

export type ToolInputIssue = StandardSchemaV1.Issue;

export type ToolContext = { signal?: AbortSignal };

// A ReachPath.path is absolute, with links followed.
export type ReachPath = { path: string; extent: "file" | "tree" };

export type Reach =
  | { kind: "paths"; paths: readonly ReachPath[] }
  | { kind: "any-local" }
  | { kind: "outside" }
  | { kind: "none" };

// One call, prepared once: the reach it will touch and the action
// bound to that reach.
export type PreparedCall<TContext> = {
  reach: Reach;
  run(context: TContext): Promise<string>;
};

export type Callee<
  TInput extends ToolSchema = ToolSchema,
  TContext = unknown,
> = ToolDefinition<TInput> & {
  // method syntax on purpose: keeps Callee<Specific> assignable to Callee
  prepare(input: ToolInput<TInput>): Promise<PreparedCall<TContext>>;
};

export type Tool<TInput extends ToolSchema = ToolSchema> = Callee<
  TInput,
  ToolContext
>;

export const defineTool = <TInput extends ToolSchema>(
  tool: Tool<TInput>,
): Tool<TInput> => tool;
