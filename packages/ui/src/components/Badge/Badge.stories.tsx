import type { Meta, StoryObj } from "@storybook/react-vite";
import { Badge } from "./Badge.js";

const meta = {
  component: Badge,
} satisfies Meta<typeof Badge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tone: "default",
    children: "Badge content",
  },
};

export const ErrorTone: Story = {
  args: {
    tone: "error",
    children: "Error: search failed: timeout",
  },
};
