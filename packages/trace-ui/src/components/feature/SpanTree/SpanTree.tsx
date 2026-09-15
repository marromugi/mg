import type { SpanNode } from "@mg/trace/store";
import { tv } from "tailwind-variants";
import { SPAN } from "../../../vocabulary.js";
import { useSpanStatus } from "./hooks/useSpanStatus.js";
import { LlmDetails } from "./LlmDetails.js";
import { ToolDetails } from "./ToolDetails.js";

const spanBox = tv({
  base: "my-2.5 rounded-lg border border-edge px-3.5 py-2.5",
  variants: {
    tone: {
      normal: "",
      error: "border-error bg-error-bg text-error-fg",
    },
  },
  defaultVariants: { tone: "normal" },
});

export const SpanTree = ({ node }: { node: SpanNode }) => {
  const { isError, message } = useSpanStatus(node);

  return (
    <div className={spanBox({ tone: isError ? "error" : "normal" })}>
      <div className="flex justify-between gap-3 font-semibold">
        <span>{node.name}</span>
        <span className="text-sm font-normal opacity-70">
          {node.startTime} – {node.endTime}
        </span>
      </div>
      {isError ? (
        <div className="font-semibold text-error">
          Error: {message ?? ""}
        </div>
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
    </div>
  );
};
