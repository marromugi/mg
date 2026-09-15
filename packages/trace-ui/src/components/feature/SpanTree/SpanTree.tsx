import type { SpanNode, SpanRecord } from "@mg/trace/store";
import { SPAN } from "../../../vocabulary.js";
import { LlmDetails } from "./LlmDetails.js";
import { ToolDetails } from "./ToolDetails.js";

const ERROR_STATUS_CODE = 2;

export const attrString = (
  attributes: SpanRecord["attributes"],
  key: string,
): string | undefined => {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
};

export const attrNumber = (
  attributes: SpanRecord["attributes"],
  key: string,
): number | undefined => {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
};

export const SpanTree = ({ node }: { node: SpanNode }) => {
  const isError = node.status.code === ERROR_STATUS_CODE;

  return (
    <div className={isError ? "span span-error" : "span"}>
      <div className="span-header">
        <span className="span-name">{node.name}</span>
        <span className="span-time">
          {node.startTime} – {node.endTime}
        </span>
      </div>
      {isError ? (
        <div className="error">Error: {node.status.message ?? ""}</div>
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
