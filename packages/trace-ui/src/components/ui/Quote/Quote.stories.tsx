import type { Meta, StoryObj } from "@storybook/react-vite";
import { Quote } from "./Quote.js";

const meta = {
  component: Quote,
} satisfies Meta<typeof Quote>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "Hello there",
  },
};
