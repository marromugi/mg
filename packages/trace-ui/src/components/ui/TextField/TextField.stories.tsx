import type { Meta, StoryObj } from "@storybook/react-vite";
import { TextField } from "./TextField.js";

const meta = {
  component: TextField,
} satisfies Meta<typeof TextField>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Empty: Story = {
  args: { name: "query", label: "Search", type: "search" },
  render: (args) => (
    <form>
      <TextField {...args} />
    </form>
  ),
};

export const WithValue: Story = {
  args: {
    name: "query",
    label: "Search",
    type: "search",
    defaultValue: "timeout",
  },
  render: (args) => (
    <form>
      <TextField {...args} />
    </form>
  ),
};

export const WithHint: Story = {
  args: {
    name: "query",
    label: "Search",
    hint: "Matches span name or attribute value.",
  },
  render: (args) => (
    <form>
      <TextField {...args} />
    </form>
  ),
};

export const WithError: Story = {
  args: {
    name: "query",
    label: "Search",
    error: "Enter at least 2 characters.",
  },
  render: (args) => (
    <form>
      <TextField {...args} />
    </form>
  ),
};

export const Disabled: Story = {
  args: { name: "query", label: "Search", disabled: true },
  render: (args) => (
    <form>
      <TextField {...args} />
    </form>
  ),
};
