import type { Meta, StoryObj } from "@storybook/react";
import { Button } from "../../ui/index.js";
import { AppFrame } from "./AppFrame.js";

const meta = {
  component: AppFrame,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof AppFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Home: Story = { args: { current: "home" } };

export const Harnesses: Story = { args: { current: "harnesses" } };

export const ApiKeys: Story = { args: { current: "api-keys" } };

export const WithActions: Story = {
  args: {
    current: "home",
    actions: (
      <Button type="button" size="md">
        操作
      </Button>
    ),
  },
};
