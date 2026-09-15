import type { Meta, StoryObj } from "@storybook/react-vite";
import { Layout } from "./Layout.js";

const meta = {
  component: Layout,
} satisfies Meta<typeof Layout>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Sessions",
    children: <p>Layout content</p>,
  },
};
