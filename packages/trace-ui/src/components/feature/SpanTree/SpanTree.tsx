import type { SpanNode } from "@mg/trace/store";
import { SPAN } from "../../../vocabulary.js";
import { useSpanStatus } from "./hooks/useSpanStatus.js";
import { LlmDetails } from "./LlmDetails.js";
import { ToolDetails } from "./ToolDetails.js";

export const SpanTree = ({ node }: { node: SpanNode }) => {
  const { isError, message } = useSpanStatus(node);

  return (
    <div className={isError ? "span span-error" : "span"}>
      <div className="span-header">
        <span className="span-name">{node.name}</span>
        <span className="span-time">
          {node.startTime} – {node.endTime}
        </span>
      </div>
      {isError ? (
        <div className="error">Error: {message ?? ""}</div>
      ) : null}
      {node.name === SPAN.llm ? <LlmDetails node={node} /> : null}
      {node.name === SPAN.tool ? <ToolDetails node={node} /> : null}
      {node.children.length > 0 ? (
        <div className="children">
          {node.children.map((child) => (
            <SpanTree key={child.spanId} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
};
