import type { Meta, StoryObj } from "@storybook/react";
import { TestRunForm } from "./TestRunForm.js";

const meta = { component: TestRunForm } satisfies Meta<
  typeof TestRunForm
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { action: "/harnesses/0b1c2d3e/runs" },
};

export const EmptyInputRefused: Story = {
  args: {
    action: "/harnesses/0b1c2d3e/runs",
    problem: "入力を書いてください",
  },
};
