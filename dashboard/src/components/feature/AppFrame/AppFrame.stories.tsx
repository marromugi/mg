import type { Meta, StoryObj } from "@storybook/react";
import { AppFrame } from "./AppFrame.js";

const meta = { component: AppFrame } satisfies Meta<typeof AppFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = {
  args: { current: "home", children: "本文" },
};

export const ApiKeys: Story = {
  args: { current: "api-keys", children: "本文" },
};
