import type { Meta, StoryObj } from "@storybook/react";
import { Notice } from "./Notice.js";

const meta = { component: Notice } satisfies Meta<typeof Notice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Error: Story = {
  args: { tone: "error", children: "保存できませんでした" },
};
