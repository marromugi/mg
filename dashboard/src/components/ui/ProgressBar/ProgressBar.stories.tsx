import type { Meta, StoryObj } from "@storybook/react";
import { ProgressBar } from "./ProgressBar.js";

const meta = {
  component: ProgressBar,
  args: { label: "進み具合" },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProgressBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Started: Story = { args: { value: 0.2 } };

export const Halfway: Story = { args: { value: 0.6 } };

export const Done: Story = { args: { value: 1 } };
