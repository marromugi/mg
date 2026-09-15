import type { SpanNode } from "@mg/trace/store";
import { useToolSpan } from "./hooks/useToolSpan.js";

export const ToolDetails = ({ node }: { node: SpanNode }) => {
  const { name, arguments: args, result } = useToolSpan(node);

  return (
    <div>
      {name !== undefined ? <div>Tool: {name}</div> : null}
      {args !== undefined ? (
        <div>
          Arguments:{" "}
          <code className="break-all whitespace-pre-wrap">{args}</code>
        </div>
      ) : null}
      {result !== undefined ? (
        <div>
          Result:{" "}
          <code className="break-all whitespace-pre-wrap">
            {result}
          </code>
        </div>
      ) : null}
    </div>
  );
};
