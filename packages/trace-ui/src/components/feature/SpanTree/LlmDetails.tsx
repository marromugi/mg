import type { SpanNode } from "@mg/trace/store";
import { ChatMessages } from "../ChatMessages/index.js";
import { useLlmSpan } from "./hooks/useLlmSpan.js";

export const LlmDetails = ({ node }: { node: SpanNode }) => {
  const {
    model,
    finishReason,
    inputTokens,
    outputTokens,
    inputMessages,
    outputMessages,
  } = useLlmSpan(node);

  return (
    <div>
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
