import type { Meta, StoryObj } from "@storybook/react";
import type { HarnessDefinition } from "../../../definition/index.js";
import { HarnessList } from "./HarnessList.js";

const chat: HarnessDefinition = {
  id: "h1",
  name: "chat",
  avatar: "chat",
  provider: { kind: "openrouter" },
  harness: { kind: "loop", model: "openai/gpt-4o", maxTurns: 10 },
};

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
  means: {
    root: "/Users/me/project",
    tools: ["read_file", "grep", "edit_file"],
    rules: [{ paths: ["src/**"], allowed: true }],
  },
};

const shell: HarnessDefinition = {
  id: "h3",
  name: "shell",
  avatar: "shell",
  provider: { kind: "ollama" },
  harness: { kind: "loop", model: "llama3.3", maxTurns: 10 },
  means: {
    root: "/Users/me/project",
    tools: ["bash"],
    rules: [],
    gate: {
      question: "この操作は、作業フォルダの中だけを変更しますか。",
    },
  },
};

const meta = {
  component: HarnessList,
  decorators: [
    (Story) => (
      <div className="max-w-page p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HarnessList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { definitions: [chat, files, shell] },
};

export const Empty: Story = { args: { definitions: [] } };
