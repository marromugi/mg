import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";

const meta = { component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    tone: "primary",
    name: "intent",
    value: "save",
    children: "保存",
  },
};

export const Neutral: Story = {
  args: { href: "/harnesses", children: "キャンセル" },
};

export const Danger: Story = {
  args: { tone: "danger", children: "削除する" },
};
