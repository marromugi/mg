import type { Meta, StoryObj } from "@storybook/react";
import { HomeIcon, ThemeIcon } from "../../../stories/icons.js";
import { IconButton } from "./IconButton.js";

const meta = {
  component: IconButton,
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
  args: { icon: HomeIcon, label: "ホーム", href: "/" },
};

export const Current: Story = {
  args: {
    icon: HomeIcon,
    label: "ホーム",
    href: "/",
    state: "current",
  },
};

export const Submit: Story = {
  args: {
    icon: ThemeIcon,
    label: "テーマを切り替える",
    name: "theme",
    value: "toggle",
  },
};
