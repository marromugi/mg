import type { Meta, StoryObj } from "@storybook/react";
import { ArrowIcon, PlusIcon } from "../Icon/index.js";
import { Button } from "./Button.js";

const meta = { component: Button } satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = {
  args: {
    tone: "primary",
    name: "intent",
    value: "save",
    children: "保存",
  },
};

export const Neutral: Story = {
  args: { href: "/harnesses", children: "キャンセル" },
};

export const Danger: Story = {
  args: { tone: "danger", children: "削除する" },
};

export const WithLeftIcon: Story = {
  args: {
    tone: "primary",
    icon: PlusIcon,
    iconSide: "left",
    children: "追加",
  },
};

export const WithRightIcon: Story = {
  args: {
    tone: "primary",
    icon: ArrowIcon,
    iconSide: "right",
    children: "次へ",
  },
};

export const Small: Story = {
  args: {
    tone: "primary",
    size: "sm",
    icon: PlusIcon,
    children: "追加",
  },
};

export const Medium: Story = {
  args: {
    tone: "primary",
    size: "md",
    icon: PlusIcon,
    children: "追加",
  },
};

export const Large: Story = {
  args: {
    tone: "primary",
    size: "lg",
    icon: PlusIcon,
    children: "追加",
  },
};
