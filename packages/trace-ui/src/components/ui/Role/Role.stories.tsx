import type { Meta, StoryObj } from "@storybook/react-vite";
import { Role } from "./Role.js";

const meta = {
  component: Role,
} satisfies Meta<typeof Role>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: "user",
  },
};
