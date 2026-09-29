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

describe("outside reach", () => {
  test("the ssh shell and the four browser tools are outside for empty arguments", async () => {
    const tools = [
      createShellTool(failingClient, {}),
      ...createBrowserTools(failingPage),
    ];

    expect(tools).toHaveLength(5);
    for (const tool of tools) {
      expect(await tool.reach({})).toEqual(outside);
    }
  });

  test("the ssh shell is outside for a command", async () => {
    const tool = createShellTool(failingClient, {});

    expect(await tool.reach({ command: "rm -rf /" })).toEqual(outside);
  });
});
