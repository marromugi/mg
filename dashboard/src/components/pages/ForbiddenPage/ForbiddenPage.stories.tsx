import type { Meta, StoryObj } from "@storybook/react";
import { ForbiddenPage } from "./ForbiddenPage.js";

const meta = {
  component: ForbiddenPage,
} satisfies Meta<typeof ForbiddenPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
