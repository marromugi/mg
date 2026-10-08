import { Markdown } from "../../ui/index.js";
import { ToolCard } from "./ToolCard.js";
import type { ChatItem } from "./transcript.js";

// One entry of the conversation, drawn by its kind. `arriving` says the
// entry is the answer still being written.
export const ChatEntry = ({
  item,
  arriving = false,
}: {
  item: ChatItem;
  arriving?: boolean;
}) => {
  switch (item.kind) {
    case "user":
      return (
        <p className="ml-8 appear self-end rounded-container bg-surface-raised container-p-3 px-4 text-xs leading-relaxed break-words whitespace-pre-wrap">
          {item.text}
        </p>
      );
    case "assistant":
      return (
        <div className="appear px-1 text-xs">
          <Markdown
            text={item.text}
            state={arriving ? "arriving" : "complete"}
          />
        </div>
      );
    case "tool":
      return <ToolCard item={item} />;
    case "restarted":
      return (
        <p className="flex appear items-center gap-3 text-xs opacity-70 before:h-px before:flex-1 before:bg-edge after:h-px after:flex-1 after:bg-edge">
          ここから新しいプロンプト
        </p>
      );
    case "stopped":
      return <p className="appear text-xs opacity-70">止めました</p>;
    case "failed":
      return (
        <p role="alert" className="appear text-xs text-error">
          返答できませんでした。{item.message}
        </p>
      );
  }
};
