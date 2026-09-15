import type { SpanNode } from "@mg/trace/store";
import { ATTR } from "../../../vocabulary.js";
import { ChatMessages } from "../ChatMessages/index.js";
import { attrNumber, attrString } from "./SpanTree.js";

export const LlmDetails = ({ node }: { node: SpanNode }) => {
  const model = attrString(node.attributes, ATTR.llmModel);
  const finishReason = attrString(
    node.attributes,
    ATTR.llmFinishReason,
  );
  const inputTokens = attrNumber(node.attributes, ATTR.llmInputTokens);
  const outputTokens = attrNumber(
    node.attributes,
    ATTR.llmOutputTokens,
  );
  const inputMessages = attrString(
    node.attributes,
    ATTR.llmInputMessages,
  );
  const outputMessages = attrString(
    node.attributes,
    ATTR.llmOutputMessages,
  );

  return (
    <div className="llm">
      {model !== undefined ? <div>Model: {model}</div> : null}
      {finishReason !== undefined ? (
        <div>Finish reason: {finishReason}</div>
      ) : null}
      {inputTokens !== undefined || outputTokens !== undefined ? (
        <div>
          Tokens: {inputTokens ?? "?"} in / {outputTokens ?? "?"} out
        </div>
      ) : null}
      {inputMessages !== undefined ? (
        <ChatMessages label="Input" raw={inputMessages} />
      ) : null}
      {outputMessages !== undefined ? (
        <ChatMessages label="Output" raw={outputMessages} />
      ) : null}
    </div>
  );
};
