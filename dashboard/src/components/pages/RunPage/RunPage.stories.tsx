import type { Meta, StoryObj } from "@storybook/react";
import {
  endedEvent,
  stoppedEvent,
  textEvent,
  toolCallEvent,
  toolResultEvent,
} from "../../../stories/fixtures.js";
import { RunEvent } from "../../feature/RunEvent/index.js";
import { RunPage } from "./RunPage.js";

const meta = { component: RunPage } satisfies Meta<typeof RunPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
  args: {
    stopAction: "/runs/6f1c/stop",
    events: (
      <>
        <RunEvent event={toolCallEvent} />
        <RunEvent event={toolResultEvent} />
        <RunEvent event={textEvent} />
      </>
    ),
  },
};

export const Ended: Story = {
  args: {
    stopAction: "/runs/6f1c/stop",
    events: (
      <>
        <RunEvent event={textEvent} />
        <RunEvent event={endedEvent} />
      </>
    ),
  },
};

export const Stopped: Story = {
  args: {
    stopAction: "/runs/6f1c/stop",
    events: (
      <>
        <RunEvent event={textEvent} />
        <RunEvent event={stoppedEvent} />
      </>
    ),
  },
};
