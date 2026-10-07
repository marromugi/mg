import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../Button/index.js";
import { Tooltip } from "./Tooltip.js";

const meta = { component: Tooltip } satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "ハーネスを作る",
    children: <Button href="/harnesses/new">作る</Button>,
  },
};
