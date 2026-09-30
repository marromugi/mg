import { prepareToolCall, type Tool } from "@mg/core";
import { describe, expect, test } from "vitest";
import type { BrowserPage } from "./cdp/browser.js";
import { createBrowserTools } from "./cdp/tools.js";
import type { SshClient } from "./ssh/client.js";
import { createShellTool } from "./ssh/tool.js";

const fail = async (): Promise<never> => {
  throw new Error("must not be called");
};

const failingClient: SshClient = { exec: fail, end: fail };

const failingPage: BrowserPage = {
  navigate: fail,
  snapshot: fail,
  click: fail,
  type: fail,
};

const outside = { kind: "outside" };

const reachOf = async (tool: Tool, args: unknown) =>
  (
    await prepareToolCall([tool], {
      id: "c1",
      name: tool.name,
      arguments: args,
    })
  ).reach;

describe("outside reach", () => {
  test("the ssh shell and the four browser tools are outside", async () => {
    const calls: [Tool, unknown][] = [
      [createShellTool(failingClient, {}), { command: "ls" }],
      ...createBrowserTools(failingPage).map(
        (tool): [Tool, unknown] => [
          tool,
          {
            browser_navigate: { url: "https://example.com" },
            browser_read: {},
            browser_click: { role: "button", name: "ok" },
            browser_type: { role: "textbox", name: "q", text: "x" },
          }[tool.name],
        ],
      ),
    ];

    expect(calls).toHaveLength(5);
    for (const [tool, args] of calls) {
      expect(await reachOf(tool, args)).toEqual(outside);
    }
  });

  test("the ssh shell is outside for a command", async () => {
    const tool = createShellTool(failingClient, {});

    expect(await reachOf(tool, { command: "rm -rf /" })).toEqual(
      outside,
    );
  });
});
