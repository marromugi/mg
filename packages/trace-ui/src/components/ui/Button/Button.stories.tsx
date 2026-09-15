import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./Button.js";

const meta = {
  component: Button,
} satisfies Meta<typeof Button>;

export default meta;

type Story = StoryObj<typeof meta>;

export const PrimarySmall: Story = {
  args: { tone: "primary", size: "sm", children: "Search" },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};

export const PrimaryMedium: Story = {
  args: { tone: "primary", size: "md", children: "Search" },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};

export const NeutralSmall: Story = {
  args: { tone: "neutral", size: "sm", children: "Cancel" },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};

export const NeutralMedium: Story = {
  args: { tone: "neutral", size: "md", children: "Cancel" },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};

export const Disabled: Story = {
  args: { tone: "primary", disabled: true, children: "Search" },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};

export const AsLink: Story = {
  args: {
    tone: "neutral",
    href: "/sessions",
    children: "View sessions",
  },
  render: (args) => (
    <form>
      <Button {...args} />
    </form>
  ),
};
