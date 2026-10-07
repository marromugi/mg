import type { SVGProps } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "./Button.js";

const PlusIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    {...props}
  >
    <path d="M8 3v10M3 8h10" />
  </svg>
);

const ArrowIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M3 8h10M9 4l4 4-4 4" />
  </svg>
);

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
