import type { Meta, StoryObj } from "@storybook/react";
import { MultiCombobox } from "./MultiCombobox.js";

const meta: Meta<typeof MultiCombobox> = {
  component: MultiCombobox,
  args: {
    name: "tools",
    label: "ツール",
    options: [
      { value: "bash", label: "bash" },
      { value: "read_file", label: "read_file" },
      { value: "grep", label: "grep" },
      { value: "write_file", label: "write_file" },
      { value: "edit_file", label: "edit_file" },
    ],
  },
  decorators: [
    (Story) => (
      <div className="h-96 max-w-sm pt-16">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof MultiCombobox>;

export const Default: Story = {};

export const SomeChosen: Story = {
  args: { defaultValue: ["read_file", "grep", "edit_file"] },
};

export const OneChosen: Story = { args: { defaultValue: ["bash"] } };

export const WithHint: Story = {
  args: { hint: "エージェントに使わせるツールを選びます。" },
};

export const WithError: Story = {
  args: { error: "ツールを 1 つ以上選んでください" },
};
