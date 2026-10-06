import type { Meta, StoryObj } from "@storybook/react";
import { HarnessesPage } from "./HarnessesPage.js";

const meta = {
  component: HarnessesPage,
} satisfies Meta<typeof HarnessesPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
