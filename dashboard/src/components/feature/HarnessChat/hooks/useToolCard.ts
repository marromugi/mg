import type { ChatItem } from "../transcript.js";

type ToolItem = Extract<ChatItem, { kind: "tool" }>;

export type ToolCard = {
  title: string;
  // One line on what the tool is doing, or did.
  summary: string;
  state: "working" | "done" | "refused";
};

// What each tool is called, and how its work reads while it goes on and
// once it is over.
const TOOLS: Record<
  string,
  { title: string; working: string; done: string }
> = {
  read_file: {
    title: "Read File",
    working: "を読んでいます…",
    done: "を読みました",
  },
  grep: {
    title: "Grep",
    working: "を検索しています…",
    done: "を検索しました",
  },
  bash: {
    title: "Bash",
    working: "を実行しています…",
    done: "を実行しました",
  },
  write_file: {
    title: "Write File",
    working: "に書いています…",
    done: "に書きました",
  },
  edit_file: {
    title: "Edit File",
    working: "を書き換えています…",
    done: "を書き換えました",
  },
};

// How one tool call shows before it is opened. A tool this does not
// know, or a call that acts on nothing named, is named by the tool
// alone.
export const useToolCard = (item: ToolItem): ToolCard => {
  const tool = TOOLS[item.name];
  const state =
    item.result === undefined
      ? "working"
      : item.result.refused
        ? "refused"
        : "done";
  const subject = item.subject ?? item.name;
  const ending =
    state === "refused"
      ? "は許可されませんでした"
      : tool === undefined || item.subject === undefined
        ? state === "working"
          ? "を実行しています…"
          : "を実行しました"
        : tool[state];

  return {
    title: tool?.title ?? item.name,
    summary: `${subject} ${ending}`,
    state,
  };
};
