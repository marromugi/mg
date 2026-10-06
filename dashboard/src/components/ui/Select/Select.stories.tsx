import type { Meta, StoryObj } from "@storybook/react";
import { Select } from "./Select.js";

const meta = { component: Select } satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;

const options = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
];

export const Default: Story = {
  args: { name: "provider", label: "プロバイダー", options },
};

export const Chosen: Story = {
  args: {
    name: "provider",
    label: "プロバイダー",
    options,
    value: "ollama",
  },
};

export const WithError: Story = {
  args: {
    name: "provider",
    label: "プロバイダー",
    options,
    error: "プロバイダーを選んでください",
  },
};
