import type { Meta, StoryObj } from "@storybook/react";
import { TextArea } from "./TextArea.js";

const meta: Meta<typeof TextArea> = {
  component: TextArea,
  args: { name: "paths", label: "パスのパターン" },
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TextArea>;

export const Default: Story = {};

export const WithPlaceholder: Story = {
  args: { placeholder: "secrets/**" },
};

export const WithValueAndHint: Story = {
  args: {
    hint: "1 行に 1 つ書きます。",
    value: ".env\nsecrets/**",
  },
};

export const WithError: Story = {
  args: {
    value: "secrets/[",
    error: "書き方が正しくありません",
  },
};

export const Tall: Story = {
  args: { rows: 8, value: ".env\nsecrets/**" },
};

export const Small: Story = {
  args: { size: "sm", value: ".env\nsecrets/**" },
};

export const Medium: Story = {
  args: { size: "md", value: ".env\nsecrets/**" },
};

// Grows with its text: five lines of text in a box that starts at three.
export const FollowsContent: Story = {
  args: {
    height: "content",
    value: ".env\nsecrets/**\n*.pem\n*.key\nid_rsa",
  },
};

// Stops growing at four lines; the rest scrolls.
export const FollowsContentUpToMax: Story = {
  args: {
    height: "content",
    maxRows: 4,
    value: ".env\nsecrets/**\n*.pem\n*.key\nid_rsa\nid_ed25519\n.netrc",
  },
};
