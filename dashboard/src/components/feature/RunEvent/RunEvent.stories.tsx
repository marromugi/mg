import type { Meta, StoryObj } from "@storybook/react";
import {
  endedEvent,
  failedEvent,
  stoppedEvent,
  textEvent,
  toolCallEvent,
  toolResultEvent,
} from "../../../stories/fixtures.js";
import { RunEvent } from "./RunEvent.js";

const meta = { component: RunEvent } satisfies Meta<typeof RunEvent>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Text: Story = { args: { event: textEvent } };

export const ToolCall: Story = { args: { event: toolCallEvent } };

export const ToolResult: Story = { args: { event: toolResultEvent } };

export const Ended: Story = { args: { event: endedEvent } };

export const Stopped: Story = { args: { event: stoppedEvent } };

export const Failed: Story = { args: { event: failedEvent } };
