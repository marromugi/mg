import type { Meta, StoryObj } from "@storybook/react";
import { apiKeySet, apiKeyUnset } from "../../../stories/fixtures.js";
import { ApiKeysPage } from "./ApiKeysPage.js";

const meta = { component: ApiKeysPage } satisfies Meta<
  typeof ApiKeysPage
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

export const SaveFailed: Story = {
  args: {
    keys: [apiKeyUnset],
    failure: {
      kind: "write",
      reason:
        "Keychain write of OPENROUTER_API_KEY failed (exit 36): User interaction is not allowed.",
    },
  },
};

export const ReadFailed: Story = {
  args: {
    keys: [],
    failure: {
      kind: "read",
      reason:
        "Keychain lookup of OPENROUTER_API_KEY failed (exit 36): User interaction is not allowed.",
    },
  },
};
