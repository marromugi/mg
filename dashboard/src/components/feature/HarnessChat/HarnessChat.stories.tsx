import type { Meta, StoryObj } from "@storybook/react";
import { HarnessChat } from "./HarnessChat.js";
import type { ChatItem } from "./transcript.js";

const conversation: ChatItem[] = [
  { kind: "user", id: "1", text: "README には何が書いてありますか。" },
  {
    kind: "tool",
    id: "2",
    name: "read_file",
    subject: "README.md",
    input: {
      kind: "code",
      language: "json",
      text: '{ "path": "README.md" }',
    },
    result: {
      shown: {
        kind: "code",
        language: "text",
        text: "# project\n\nA small tool that…",
      },
      refused: false,
    },
  },
  {
    kind: "assistant",
    id: "3",
    text: "README には、このツールの目的と使い方が書いてあります。",
  },
];

const meta = {
  component: HarnessChat,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div className="flex h-screen justify-end p-3">
        <Story />
      </div>
    ),
  ],
  args: {
    items: conversation,
    state: "idle",
    prompt: "saved",
    onSend: () => {},
    onStop: () => {},
    onReset: () => {},
  },
} satisfies Meta<typeof HarnessChat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { args: { items: [] } };

export const Answered: Story = {};

export const Answering: Story = {
  args: {
    state: "answering",
    items: [
      conversation[0],
      {
        kind: "tool",
        id: "2",
        name: "read_file",
        subject: "README.md",
        input: {
          kind: "code",
          language: "json",
          text: '{ "path": "README.md" }',
        },
      },
    ],
  },
};

export const UnsavedPrompt: Story = {
  args: {
    prompt: "unsaved",
    items: [
      ...conversation,
      { kind: "restarted", id: "4" },
      { kind: "user", id: "5", text: "もう一度、短く教えてください。" },
      { kind: "assistant", id: "6", text: "目的と使い方です。" },
    ],
  },
};

export const Refused: Story = {
  args: {
    items: [
      { kind: "user", id: "1", text: ".env を見せてください。" },
      {
        kind: "tool",
        id: "2",
        name: "read_file",
        subject: "README.md",
        input: {
          kind: "code",
          language: "json",
          text: '{ "path": ".env" }',
        },
        result: {
          shown: {
            kind: "code",
            language: "text",
            text: "許可していないパスです",
          },
          refused: true,
        },
      },
      {
        kind: "assistant",
        id: "3",
        text: "そのファイルは読めない設定になっています。",
      },
    ],
  },
};

export const Stopped: Story = {
  args: {
    items: [conversation[0], { kind: "stopped", id: "2" }],
  },
};

export const Failed: Story = {
  args: {
    items: [
      conversation[0],
      {
        kind: "failed",
        id: "2",
        message: "OPENROUTER_API_KEY が設定されていません。",
      },
    ],
  },
};
