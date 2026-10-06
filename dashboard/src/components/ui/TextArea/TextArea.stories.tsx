import type { Meta, StoryObj } from "@storybook/react";
import { TextArea } from "./TextArea.js";

const meta = { component: TextArea } satisfies Meta<typeof TextArea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "paths", label: "パスのパターン" },
};

export const WithValueAndHint: Story = {
  args: {
    name: "paths",
    label: "パスのパターン",
    hint: "1 行に 1 つ書きます。",
    value: ".env\nsecrets/**",
  },
};

export const WithError: Story = {
  args: {
    name: "paths",
    label: "パスのパターン",
    error: "書き方が正しくありません",
  },
};
