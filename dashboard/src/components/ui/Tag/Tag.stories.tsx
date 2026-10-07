import type { Meta, StoryObj } from "@storybook/react";
import { Tag } from "./Tag.js";

const meta = {
  component: Tag,
  args: { children: "read_file" },
} satisfies Meta<typeof Tag>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Several: Story = {
  render: () => (
    <div className="flex flex-wrap gap-2">
      <Tag>read_file</Tag>
      <Tag>grep</Tag>
      <Tag>edit_file</Tag>
    </div>
  ),
};
