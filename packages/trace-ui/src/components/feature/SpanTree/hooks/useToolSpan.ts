import type { SpanNode } from "@mg/trace/store";
import { attrString } from "../../../../hooks/attributes.js";
import { ATTR } from "../../../../vocabulary.js";

export type ToolSpan = {
  name?: string;
  arguments?: string;
  result?: string;
};

export const useToolSpan = (node: SpanNode): ToolSpan => ({
  name: attrString(node.attributes, ATTR.toolName),
  arguments: attrString(node.attributes, ATTR.toolArguments),
  result: attrString(node.attributes, ATTR.toolResult),
});
