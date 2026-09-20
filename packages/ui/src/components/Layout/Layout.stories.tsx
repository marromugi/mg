import type { Meta, StoryObj } from "@storybook/react-vite";
import { parseScheme } from "../../scheme.js";
import { Layout } from "./Layout.js";

const meta = {
  component: Layout,
} satisfies Meta<typeof Layout>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    title: "Sessions",
    scheme: "system",
    css: "",
    schemeAction: "/theme",
    children: <p>Layout content</p>,
  },
  render: (args, { globals }) => (
    <Layout {...args} scheme={parseScheme(globals.scheme)} />
  ),
};

export const Dark: Story = {
  args: {
    title: "Sessions",
    scheme: "dark",
    css: "",
    schemeAction: "/theme",
    children: <p>Layout content</p>,
  },
};
