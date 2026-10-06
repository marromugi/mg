import type { Meta, StoryObj } from "@storybook/react";
import { RunNotStoppedPage } from "./RunNotStoppedPage.js";

const meta = {
  component: RunNotStoppedPage,
} satisfies Meta<typeof RunNotStoppedPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { runHref: "/runs/6f1c" },
};
