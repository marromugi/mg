import type { Meta, StoryObj } from "@storybook/react";
import { PlusIcon } from "../../../stories/icons.js";
import { Icon } from "./Icon.js";

const meta = { component: Icon } satisfies Meta<typeof Icon>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { icon: PlusIcon } };

export const Small: Story = { args: { icon: PlusIcon, size: "sm" } };

export const Large: Story = { args: { icon: PlusIcon, size: "lg" } };

export const Accent: Story = {
  args: { icon: PlusIcon, tone: "accent" },
};

export const ErrorTone: Story = {
  args: { icon: PlusIcon, tone: "error" },
};

export const WithClassName: Story = {
  args: {
    icon: PlusIcon,
    tone: "accent",
    className: "size-8 text-error",
  },
};
