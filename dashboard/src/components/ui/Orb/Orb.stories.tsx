import type { Meta, StoryObj } from "@storybook/react";
import { Orb } from "./Orb.js";

const meta = {
  component: Orb,
  args: { seed: "files", size: "xl" },
  decorators: [
    (Story) => (
      <div className="p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Orb>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithLabel: Story = { args: { label: "files の顔" } };

const SEEDS = [
  "files",
  "reviewer",
  "translator",
  "research",
  "support",
  "planner",
  "writer",
  "ops",
];

// One orb for each seed, at the size the creation steps show.
export const Seeds: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4">
      {SEEDS.map((seed) => (
        <Orb key={seed} seed={seed} size="xl" />
      ))}
    </div>
  ),
};

// The sizes, down to the one a list row shows.
export const Sizes: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Orb seed="files" size="xl" />
      <Orb seed="files" size="lg" />
      <Orb seed="files" size="md" />
      <Orb seed="files" size="sm" />
    </div>
  ),
};
