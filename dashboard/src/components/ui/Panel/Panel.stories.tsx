import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/index.js";
import { Panel } from "./Panel.js";

const meta = {
  component: Panel,
  decorators: [
    (Story) => (
      <div className="h-screen p-4">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Panel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "補助",
    top: <p className="text-sm font-semibold">見出し</p>,
    bottom: (
      <Button type="button" size="md">
        操作
      </Button>
    ),
    children: <p className="text-sm">中身</p>,
  },
};

export const ContentOnly: Story = {
  args: { label: "補助", children: <p className="text-sm">中身</p> },
};
