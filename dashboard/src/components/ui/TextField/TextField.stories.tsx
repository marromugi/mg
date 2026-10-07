import type { Meta, StoryObj } from "@storybook/react";
import { TextField } from "./TextField.js";

const meta: Meta<typeof TextField> = {
  component: TextField,
  decorators: [
    (Story) => (
      <div className="max-w-sm">
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof TextField>;

export const Default: Story = {
  args: { name: "name", label: "名前" },
};

export const WithPlaceholder: Story = {
  args: { name: "name", label: "名前", placeholder: "files" },
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
  args: { name: "apiKey", label: "API キー", type: "password" },
};

export const NumberInput: Story = {
  args: {
    name: "maxTurns",
    label: "ターン数の上限",
    type: "number",
    value: "10",
  },
};

export const Small: Story = {
  args: { name: "name", label: "名前", value: "files", size: "sm" },
};

export const Medium: Story = {
  args: { name: "name", label: "名前", value: "files", size: "md" },
};

export const Large: Story = {
  args: { name: "name", label: "名前", value: "files", size: "lg" },
};

export const Sizes: Story = {
  args: { name: "name", label: "名前" },
  render: () => (
    <div className="flex flex-col gap-4">
      <TextField name="sm" label="sm" value="files" size="sm" />
      <TextField name="md" label="md" value="files" size="md" />
      <TextField name="lg" label="lg" value="files" size="lg" />
    </div>
  ),
};
