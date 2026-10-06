import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./Checkbox.js";

const meta = { component: Checkbox } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {
  args: { name: "tools", value: "grep", label: "grep" },
};

export const Checked: Story = {
  args: { name: "tools", value: "grep", label: "grep", checked: true },
};
