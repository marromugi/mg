import type { Meta, StoryObj } from "@storybook/react";
import { traceDir } from "../../../stories/fixtures.js";
import { RunMissingPage } from "./RunMissingPage.js";

const meta = {
  component: RunMissingPage,
} satisfies Meta<typeof RunMissingPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { traceDir } };
