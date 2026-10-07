import type { Meta, StoryObj } from "@storybook/react";
import { Avatar } from "./Avatar.js";

const meta = {
  component: Avatar,
  args: { seed: "files" },
} satisfies Meta<typeof Avatar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Small: Story = { args: { size: "sm" } };

export const Large: Story = { args: { size: "lg" } };

export const WithLabel: Story = { args: { label: "files の顔" } };

const SEEDS = [
  "files",
  "reviewer",
  "translator",
  "research",
  "support",
];

// One face for each seed.
export const Seeds: Story = {
  render: () => (
    <div className="flex gap-3">
      {SEEDS.map((seed) => (
        <Avatar key={seed} seed={seed} />
      ))}
    </div>
  ),
};
