import type { SpanNode } from "@mg/trace/store";
import { ATTR } from "../../../vocabulary.js";
import { attrString } from "./SpanTree.js";

export const ToolDetails = ({ node }: { node: SpanNode }) => {
  const name = attrString(node.attributes, ATTR.toolName);
  const args = attrString(node.attributes, ATTR.toolArguments);
  const result = attrString(node.attributes, ATTR.toolResult);

  return (
    <div className="tool">
      {name !== undefined ? <div>Tool: {name}</div> : null}
      {args !== undefined ? (
        <div>
          Arguments: <code>{args}</code>
        </div>
      ) : null}
      {result !== undefined ? (
        <div>
          Result: <code>{result}</code>
        </div>
      ) : null}
    </div>
  );
};
