import type { Meta, StoryObj } from "@storybook/react";
import { RefusalPage } from "./RefusalPage.js";

const meta = {
  component: RefusalPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof RefusalPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoSession: Story = { args: { refusal: "no-session" } };

export const Forbidden: Story = { args: { refusal: "forbidden" } };
