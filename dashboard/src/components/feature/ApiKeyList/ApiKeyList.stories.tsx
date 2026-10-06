import type { Meta, StoryObj } from "@storybook/react";
import { apiKeySet, apiKeyUnset } from "../../../stories/fixtures.js";
import { ApiKeyList } from "./ApiKeyList.js";

const meta = { component: ApiKeyList } satisfies Meta<
  typeof ApiKeyList
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NotSet: Story = { args: { keys: [apiKeyUnset] } };

export const Set: Story = { args: { keys: [apiKeySet] } };

export const EmptyValueRefused: Story = {
  args: {
    keys: [apiKeyUnset],
    problem: {
      name: "OPENROUTER_API_KEY",
      message: "キーを入力してください",
    },
  },
};
