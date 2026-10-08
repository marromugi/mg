import { useRef, useState } from "react";
import {
  ArrowIcon,
  CloseIcon,
  IconButton,
  Panel,
  PlusIcon,
  Tag,
  TextArea,
} from "../../ui/index.js";
import { ChatEntry } from "./ChatEntry.js";
import type { ChatItem } from "./transcript.js";

type HarnessChatProps = {
  items: readonly ChatItem[];
  state: "idle" | "answering";
  // Whether the agent answers from the saved prompt or the edited one.
  prompt: "saved" | "unsaved";
  onSend: (input: string) => void;
  onStop: () => void;
  onReset: () => void;
};

// The panel an agent is tried in: the conversation so far, and the box
// a message is sent from. While the agent answers, the send button is
// the stop button.
export const HarnessChat = ({
  items,
  state,
  prompt,
  onSend,
  onStop,
  onReset,
}: HarnessChatProps) => {
  const [input, setInput] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);

  const send = () => {
    if (input.trim() === "" || state === "answering") return;
    onSend(input);
    setInput("");
    if (box.current !== null) box.current.value = "";
  };

  return (
    <Panel
      label="試す"
      scroll="follow"
      top={
        <div className="flex min-h-10 items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="pl-1 text-sm font-semibold">試す</h2>
            {prompt === "unsaved" ? (
              <Tag>保存前のプロンプト</Tag>
            ) : null}
          </div>
          {items.length === 0 ? null : (
            <IconButton
              type="button"
              icon={PlusIcon}
              label="新しい会話を始める"
              labelSide="left"
              size="sm"
              onClick={onReset}
            />
          )}
        </div>
      }
      bottom={
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextArea
              ref={box}
              name="input"
              label="メッセージ"
              layout="bare"
              size="sm"
              rows={1}
              height="content"
              maxRows={8}
              placeholder="メッセージを書く"
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key !== "Enter" ||
                  event.shiftKey ||
                  event.nativeEvent.isComposing
                ) {
                  return;
                }
                event.preventDefault();
                send();
              }}
            />
          </div>
          {state === "answering" ? (
            <IconButton
              type="button"
              icon={CloseIcon}
              label="止める"
              labelSide="top"
              onClick={onStop}
            />
          ) : (
            <IconButton
              type="button"
              icon={ArrowIcon}
              label="送る"
              labelSide="top"
              disabled={input.trim() === ""}
              onClick={send}
            />
          )}
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="px-1 text-xs opacity-70">
          メッセージを送ると、このエージェントが返答します。
        </p>
      ) : (
        <div
          className="flex flex-col gap-5 px-1 py-2"
          aria-live="polite"
        >
          {items.map((item, index) => (
            <ChatEntry
              key={item.id}
              item={item}
              arriving={
                state === "answering" && index === items.length - 1
              }
            />
          ))}
          {state === "answering" ? (
            <p className="animate-pulse text-xs opacity-70">返答中</p>
          ) : null}
        </div>
      )}
    </Panel>
  );
};
