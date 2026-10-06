import type { Meta, StoryObj } from "@storybook/react";
import { NavLink } from "./NavLink.js";

const meta = { component: NavLink } satisfies Meta<typeof NavLink>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { href: "/harnesses", children: "ハーネス" },
};

export const Current: Story = {
  args: { href: "/harnesses", state: "current", children: "ハーネス" },
};
