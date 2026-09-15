import type {
  StandardJSONSchemaV1,
  StandardSchemaV1,
} from "@standard-schema/spec";
import type { ToolDefinition } from "../providers/types.js";

export type ToolSchema = StandardSchemaV1 & StandardJSONSchemaV1;

export type ToolContext = { signal?: AbortSignal };

export type Tool<TInput extends ToolSchema = ToolSchema> =
  ToolDefinition<TInput> & {
    // method syntax on purpose: keeps Tool<Specific> assignable to Tool
    execute(
      input: StandardSchemaV1.InferOutput<TInput>,
      context: ToolContext,
    ): Promise<string>;
  };

export const defineTool = <TInput extends ToolSchema>(
  tool: Tool<TInput>,
): Tool<TInput> => tool;
