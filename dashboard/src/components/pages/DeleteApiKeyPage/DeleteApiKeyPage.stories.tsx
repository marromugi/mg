import type { Meta, StoryObj } from "@storybook/react";
import { DeleteApiKeyPage } from "./DeleteApiKeyPage.js";

const meta = {
  component: DeleteApiKeyPage,
} satisfies Meta<typeof DeleteApiKeyPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "OPENROUTER_API_KEY" },
};

export const DeleteFailed: Story = {
  args: {
    name: "OPENROUTER_API_KEY",
    failure:
      "Keychain delete of OPENROUTER_API_KEY failed (exit 36): User interaction is not allowed.",
  },
};
