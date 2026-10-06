import type { Meta, StoryObj } from "@storybook/react";
import { TextLink } from "./TextLink.js";

const meta = { component: TextLink } satisfies Meta<typeof TextLink>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { href: "/harnesses/1", children: "files" },
};
