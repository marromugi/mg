import type { Meta, StoryObj } from "@storybook/react";
import { TextField } from "./TextField.js";

const meta = { component: TextField } satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { name: "name", label: "名前" },
};

export const WithValueAndHint: Story = {
  args: {
    name: "name",
    label: "名前",
    hint: "ほかのハーネスと重ならない名前にします。",
    value: "files",
  },
};

export const WithError: Story = {
  args: {
    name: "name",
    label: "名前",
    value: "files",
    error: "この名前は、ほかのハーネスで使われています",
  },
};

export const Password: Story = {
  args: {
    name: "apiKey",
    label: "API キー",
    type: "password",
  },
};

export const NumberInput: Story = {
  args: {
    name: "maxTurns",
    label: "ターン数の上限",
    type: "number",
    value: "10",
  },
};
