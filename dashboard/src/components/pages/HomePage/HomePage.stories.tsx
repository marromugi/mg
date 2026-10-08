import type { Meta, StoryObj } from "@storybook/react";
import { expect, fn, screen, userEvent, waitFor } from "storybook/test";
import {
  getCreateHarnessMockHandler201,
  getCreateHarnessMockHandler422,
  getCreateHarnessMockHandler500,
} from "../../../api-client/mocks.js";
import { HomePage } from "./HomePage.js";

const meta = {
  component: HomePage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof HomePage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

// What the API was sent, for a story to check.
const sent = fn();

// Goes through every step for a harness with no tools, up to the
// button that saves it.
const askForHarness = async () => {
  await userEvent.click(
    screen.getByRole("button", { name: "エージェントを作る" }),
  );
  await userEvent.type(
    await screen.findByLabelText(/エージェント名/),
    "files",
  );
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));

  await userEvent.click(
    await screen.findByLabelText("カスタムで設定する"),
  );
  await userEvent.type(
    await screen.findByLabelText(/モデル/),
    "openai/gpt-4o",
  );
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));

  await screen.findByText("使えるツール");
  await userEvent.click(screen.getByRole("button", { name: "次へ" }));

  await screen.findByLabelText(/最大ターン数/);
  await userEvent.click(
    screen.getByRole("button", { name: "作成する" }),
  );
};

export const SavesHarness: Story = {
  parameters: {
    msw: {
      handlers: [
        getCreateHarnessMockHandler201(async ({ request }) => {
          sent(await request.json());
          return { id: "0b5c1f2e" };
        }),
      ],
    },
  },
  beforeEach: () => {
    sent.mockClear();
  },
  play: async () => {
    await askForHarness();

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await expect(sent).toHaveBeenCalledWith({
      draft: {
        name: "files",
        avatar: "files",
        provider: "openrouter",
        baseUrl: "",
        model: "openai/gpt-4o",
        maxTurns: "10",
        tools: [],
        root: "",
        rules: [],
        judge: false,
        judgeModel: "",
        judgeInstruction: "",
        system: "",
        gate: false,
        gateQuestion: "",
      },
    });
  },
};

export const NameTaken: Story = {
  parameters: {
    msw: {
      handlers: [
        getCreateHarnessMockHandler422({
          problems: [
            {
              field: "name",
              message: "この名前は、ほかのエージェントで使われています",
            },
          ],
        }),
      ],
    },
  },
  play: async () => {
    await askForHarness();

    await expect(
      await screen.findByText(
        "この名前は、ほかのエージェントで使われています",
      ),
    ).toBeVisible();
    await expect(screen.getByLabelText(/エージェント名/)).toHaveValue(
      "files",
    );
  },
};

export const SaveFails: Story = {
  parameters: {
    msw: {
      handlers: [
        getCreateHarnessMockHandler500({ reason: "disk is full" }),
      ],
    },
  },
  play: async () => {
    await askForHarness();

    await expect(await screen.findByRole("alert")).toHaveTextContent(
      "保存できませんでした。disk is full",
    );
    await expect(screen.getByLabelText(/最大ターン数/)).toHaveValue(10);
  },
};
