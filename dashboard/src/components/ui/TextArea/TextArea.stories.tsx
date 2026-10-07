import type { Meta, StoryObj } from "@storybook/react";
import { TextArea } from "./TextArea.js";

const meta = {
  component: TextArea,
  args: { name: "paths", label: "パスのパターン" },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TextArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithPlaceholder: Story = {
  args: { placeholder: "secrets/**" },
};

export const WithValueAndHint: Story = {
  args: {
    hint: "1 行に 1 つ書きます。",
    value: ".env\nsecrets/**",
  },
};

export const WithError: Story = {
  args: {
    value: "secrets/[",
    error: "書き方が正しくありません",
  },
};

export const Tall: Story = {
  args: { rows: 8, value: ".env\nsecrets/**" },
};

export const Small: Story = {
  args: { size: "sm", value: ".env\nsecrets/**" },
};

export const Medium: Story = {
  args: { size: "md", value: ".env\nsecrets/**" },
};
