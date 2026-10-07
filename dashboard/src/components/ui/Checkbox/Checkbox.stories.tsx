import type { Meta, StoryObj } from "@storybook/react";
import { Checkbox } from "./Checkbox.js";

const meta: Meta<typeof Checkbox> = {
  component: Checkbox,
  args: { name: "tools", value: "grep", label: "grep" },
};
export default meta;
type Story = StoryObj<typeof Checkbox>;

export const Unchecked: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Indeterminate: Story = { args: { indeterminate: true } };

export const Bare: Story = {
  args: { layout: "bare", defaultChecked: true },
};
