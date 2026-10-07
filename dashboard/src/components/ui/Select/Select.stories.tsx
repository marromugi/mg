import type { Meta, StoryObj } from "@storybook/react";
import { HomeIcon, KeyIcon, ListIcon } from "../../../stories/icons.js";
import { Icon } from "../Icon/index.js";
import { Select } from "./Select.js";

const meta: Meta<typeof Select> = {
  component: Select,
  args: {
    name: "provider",
    label: "プロバイダー",
    options: [
      { value: "openrouter", label: "OpenRouter" },
      { value: "ollama", label: "Ollama" },
      { value: "anthropic", label: "Anthropic" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="h-80 max-w-sm">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {};

export const Chosen: Story = { args: { defaultValue: "ollama" } };

export const WithHint: Story = {
  args: {
    defaultValue: "openrouter",
    hint: "ハーネスが呼び出す LLM の提供元です。",
  },
};

export const WithError: Story = {
  args: { error: "プロバイダーを選んでください" },
};

export const Small: Story = {
  args: { defaultValue: "ollama", size: "sm" },
};

export const Medium: Story = {
  args: { defaultValue: "ollama", size: "md" },
};

// Each option draws an icon beside its name in the list and in the
// control; the browser's own select shows the name alone.
export const WithIcons: Story = {
  args: {
    name: "page",
    label: "最初に開く画面",
    defaultValue: "harnesses",
    options: [
      {
        value: "home",
        label: "ホーム",
        content: (
          <span className="flex items-center gap-2">
            <Icon icon={HomeIcon} />
            ホーム
          </span>
        ),
      },
      {
        value: "harnesses",
        label: "ハーネス",
        content: (
          <span className="flex items-center gap-2">
            <Icon icon={ListIcon} />
            ハーネス
          </span>
        ),
      },
      {
        value: "api-keys",
        label: "API キー",
        content: (
          <span className="flex items-center gap-2">
            <Icon icon={KeyIcon} />
            API キー
          </span>
        ),
      },
    ],
  },
};
