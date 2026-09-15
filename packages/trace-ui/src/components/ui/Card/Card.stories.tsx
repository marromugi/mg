import type { Meta, StoryObj } from "@storybook/react-vite";
import { Card } from "./Card.js";

const meta = {
  component: Card,
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    tone: "default",
    children: "Card content",
  },
};

export const ErrorTone: Story = {
  args: {
    tone: "error",
    children: "Card content",
  },
};
