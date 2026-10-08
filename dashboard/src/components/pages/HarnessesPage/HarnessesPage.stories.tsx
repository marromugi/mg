import type { Meta, StoryObj } from "@storybook/react";
import type { HarnessDefinition } from "../../../definition/index.js";
import { HarnessesPage } from "./HarnessesPage.js";

const definitions: HarnessDefinition[] = [
  {
    id: "h1",
    name: "chat",
    avatar: "chat",
    provider: { kind: "openrouter" },
    harness: { kind: "loop", model: "openai/gpt-4o", maxTurns: 10 },
  },
  {
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
  },
  {
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
  },
];

const meta = {
  component: HarnessesPage,
  parameters: { layout: "fullscreen" },
  args: { definitions, unreadable: [] },
} satisfies Meta<typeof HarnessesPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { definitions: [] } };

export const WithUnreadable: Story = {
  args: { unreadable: ["broken.json"] },
};

export const Failed: Story = {
  args: { definitions: [], failure: "ENOTDIR: not a directory" },
};
