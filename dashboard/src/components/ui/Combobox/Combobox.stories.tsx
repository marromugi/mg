import type { Meta, StoryObj } from "@storybook/react";
import { Combobox } from "./Combobox.js";

const meta: Meta<typeof Combobox> = {
  component: Combobox,
  args: {
    name: "model",
    label: "モデル",
    options: [
      { value: "openai/gpt-5", label: "OpenAI GPT-5" },
      { value: "openai/gpt-5-mini", label: "OpenAI GPT-5 mini" },
      { value: "anthropic/claude-opus", label: "Claude Opus" },
      { value: "anthropic/claude-sonnet", label: "Claude Sonnet" },
      { value: "deepseek/deepseek-v4", label: "DeepSeek V4" },
      { value: "google/gemini-3", label: "Gemini 3" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="h-96 max-w-sm">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Combobox>;

export const Default: Story = {};

export const Chosen: Story = {
  args: { defaultValue: "anthropic/claude-sonnet" },
};

export const WithHint: Story = {
  args: { hint: "名前の一部を入力すると、候補が絞られます。" },
};

export const WithError: Story = {
  args: { error: "モデルを選んでください" },
};

export const Small: Story = {
  args: { size: "sm", defaultValue: "openai/gpt-5" },
};

export const Medium: Story = {
  args: { size: "md", defaultValue: "openai/gpt-5" },
};
