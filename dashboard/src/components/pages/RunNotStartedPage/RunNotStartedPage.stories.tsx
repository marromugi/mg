import type { Meta, StoryObj } from "@storybook/react";
import { RunNotStartedPage } from "./RunNotStartedPage.js";

const meta = {
  component: RunNotStartedPage,
} satisfies Meta<typeof RunNotStartedPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MissingKey: Story = {
  args: {
    missingSecret: "OPENROUTER_API_KEY",
    harnessHref: "/harnesses/0b1c2d3e",
  },
};
