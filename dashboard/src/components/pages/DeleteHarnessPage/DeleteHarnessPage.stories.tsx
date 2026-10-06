import type { Meta, StoryObj } from "@storybook/react";
import { filesHarness } from "../../../stories/fixtures.js";
import { DeleteHarnessPage } from "./DeleteHarnessPage.js";

const meta = {
  component: DeleteHarnessPage,
} satisfies Meta<typeof DeleteHarnessPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { definition: filesHarness } };
