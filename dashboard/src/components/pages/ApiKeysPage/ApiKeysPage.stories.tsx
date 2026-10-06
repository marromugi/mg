import type { Meta, StoryObj } from "@storybook/react";
import { ApiKeysPage } from "./ApiKeysPage.js";

const meta = { component: ApiKeysPage } satisfies Meta<
  typeof ApiKeysPage
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
