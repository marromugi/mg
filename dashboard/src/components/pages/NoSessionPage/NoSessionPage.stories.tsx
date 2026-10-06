import type { Meta, StoryObj } from "@storybook/react";
import { NoSessionPage } from "./NoSessionPage.js";

const meta = {
  component: NoSessionPage,
} satisfies Meta<typeof NoSessionPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
