import type { SpanNode, SpanRecord } from "@mg/trace/store";
import { ATTR, SPAN } from "../vocabulary.js";
import { MessagesView } from "./messages.js";

const ERROR_STATUS_CODE = 2;

const attrString = (attributes: SpanRecord["attributes"], key: string): string | undefined => {
  const value = attributes[key];
  return typeof value === "string" ? value : undefined;
};

const attrNumber = (attributes: SpanRecord["attributes"], key: string): number | undefined => {
  const value = attributes[key];
  return typeof value === "number" ? value : undefined;
};

const LlmDetails = ({ node }: { node: SpanNode }) => {
  const model = attrString(node.attributes, ATTR.llmModel);
  const finishReason = attrString(node.attributes, ATTR.llmFinishReason);
  const inputTokens = attrNumber(node.attributes, ATTR.llmInputTokens);
  const outputTokens = attrNumber(node.attributes, ATTR.llmOutputTokens);
  const inputMessages = attrString(node.attributes, ATTR.llmInputMessages);
  const outputMessages = attrString(node.attributes, ATTR.llmOutputMessages);

  return (
    <div className="llm">
      {model !== undefined ? <div>Model: {model}</div> : null}
      {finishReason !== undefined ? <div>Finish reason: {finishReason}</div> : null}
      {inputTokens !== undefined || outputTokens !== undefined ? (
        <div>
          Tokens: {inputTokens ?? "?"} in / {outputTokens ?? "?"} out
        </div>
      ) : null}
      {inputMessages !== undefined ? <MessagesView label="Input" raw={inputMessages} /> : null}
      {outputMessages !== undefined ? <MessagesView label="Output" raw={outputMessages} /> : null}
    </div>
  );
};

const ToolDetails = ({ node }: { node: SpanNode }) => {
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

export const SpanNodeView = ({ node }: { node: SpanNode }) => {
  const isError = node.status.code === ERROR_STATUS_CODE;

  return (
    <div className={isError ? "span span-error" : "span"}>
      <div className="span-header">
        <span className="span-name">{node.name}</span>
        <span className="span-time">
          {node.startTime} – {node.endTime}
        </span>
      </div>
      {isError ? <div className="error">Error: {node.status.message ?? ""}</div> : null}
      {node.name === SPAN.llm ? <LlmDetails node={node} /> : null}
      {node.name === SPAN.tool ? <ToolDetails node={node} /> : null}
      {node.children.length > 0 ? (
        <div className="children">
          {node.children.map((child) => (
            <SpanNodeView key={child.spanId} node={child} />
          ))}
        </div>
      ) : null}
    </div>
  );
};
