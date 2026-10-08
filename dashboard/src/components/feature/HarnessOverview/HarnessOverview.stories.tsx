import type { Meta, StoryObj } from "@storybook/react";
import type { HarnessDefinition } from "../../../definition/index.js";
import { HarnessOverview } from "./HarnessOverview.js";

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

const chat: HarnessDefinition = {
  id: "h1",
  name: "chat",
  avatar: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "openai/gpt-4o", maxTurns: 10 },
};

const meta = {
  component: HarnessOverview,
  decorators: [
    (Story) => (
      <div className="max-w-page p-6">
        <Story />
      </div>
    ),
  ],
  args: {
    definition: files,
    promptState: "saved",
    onPromptChange: () => {},
    onSave: () => {},
  },
} satisfies Meta<typeof HarnessOverview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Saved: Story = {};

export const Unsaved: Story = { args: { promptState: "unsaved" } };

export const Saving: Story = { args: { promptState: "saving" } };

export const SaveFailed: Story = {
  args: {
    promptState: "unsaved",
    failure: "保存できませんでした。EACCES: permission denied",
  },
};

export const ConversationOnly: Story = { args: { definition: chat } };
