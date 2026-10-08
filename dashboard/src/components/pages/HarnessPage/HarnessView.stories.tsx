import type { Meta, StoryObj } from "@storybook/react";
import type { HarnessDefinition } from "../../../definition/index.js";
import type { Trial } from "../../feature/HarnessChat/index.js";
import { HarnessView, type SaveOutcome } from "./HarnessView.js";

const files: HarnessDefinition = {
  id: "h2",
  name: "files",
  avatar: "files",
  provider: { kind: "openrouter" },
  harness: {
    kind: "loop",
    model: "deepseek/deepseek-v4-flash",
    maxTurns: 20,
  },
  system:
    "あなたはこのリポジトリの案内役です。\n質問には、該当するファイルを読んでから答えてください。",
  means: {
    root: "/Users/me/project",
    tools: ["read_file", "grep", "edit_file"],
    rules: [{ paths: ["src/**"], allowed: true }],
  },
};

const quiet: Trial = {
  items: [],
  state: "idle",
  send: () => {},
  stop: () => {},
  reset: () => {},
};

const answered: Trial = {
  ...quiet,
  items: [
    {
      kind: "user",
      id: "1",
      text: "README には何が書いてありますか。",
    },
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
  ],
};

const meta = {
  component: HarnessView,
  parameters: { layout: "fullscreen" },
  args: {
    definition: files,
    trial: quiet,
    save: async (): Promise<SaveOutcome> => ({ kind: "saved" }),
  },
} satisfies Meta<typeof HarnessView>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tried: Story = { args: { trial: answered } };

export const Answering: Story = {
  args: {
    trial: {
      ...quiet,
      state: "answering",
      items: [answered.items[0]],
    },
  },
};

export const SaveFails: Story = {
  args: {
    save: async () => ({
      kind: "failed",
      reason: "EACCES: permission denied",
    }),
  },
};
