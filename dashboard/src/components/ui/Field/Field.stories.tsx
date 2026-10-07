import type { Meta, StoryObj } from "@storybook/react";
import { Field, control } from "./Field.js";

const meta = {
  component: Field,
  args: {
    name: "name",
    label: "名前",
    children: <input id="name" className={control()} />,
  },
} satisfies Meta<typeof Field>;
export default meta;
type Story = StoryObj<typeof meta>;

export const LabelOnly: Story = {};

export const WithHintAndError: Story = {
  args: {
    hint: "ほかのハーネスと重ならない名前にします。",
    error: "名前を入力してください",
  },
};

export const Required: Story = { args: { required: true } };
