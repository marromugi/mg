import type { SpanNode } from "@mg/trace/store";
import { SPAN } from "../../../vocabulary.js";
import { Badge, Card } from "../../ui/index.js";
import { useSpanStatus } from "./hooks/useSpanStatus.js";
import { LlmDetails } from "./LlmDetails.js";
import { ToolDetails } from "./ToolDetails.js";

export const SpanTree = ({ node }: { node: SpanNode }) => {
  const { isError, message } = useSpanStatus(node);

  return (
    <Card tone={isError ? "error" : "default"}>
      <div className="flex justify-between gap-3 font-semibold">
        <span>{node.name}</span>
        <span className="text-meta font-normal opacity-70">
          {node.startTime} – {node.endTime}
        </span>
      </div>
      {isError ? (
        <Badge tone="error">Error: {message ?? ""}</Badge>
      ) : null}
      {node.name === SPAN.llm ? <LlmDetails node={node} /> : null}
      {node.name === SPAN.tool ? <ToolDetails node={node} /> : null}
      {node.children.length > 0 ? (
        <div className="ml-5">
          {node.children.map((child) => (
            <SpanTree key={child.spanId} node={child} />
          ))}
        </div>
      ) : null}
    </Card>
  );
};
