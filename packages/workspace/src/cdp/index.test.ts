import { describe, expect, test } from "vitest";
import { createCdpConnector } from "./index.js";
import type { BrowserPage, BrowserSession } from "./browser.js";

const options = { url: "http://localhost:9222" };

const fakePage: BrowserPage = {
  navigate: async (url) => ({ url, title: "" }),
  snapshot: async () => "",
  click: async () => {},
  type: async () => {},
};

describe("createCdpConnector", () => {
  test("kind is cdp and open() returns the four browser tools", async () => {
    const session: BrowserSession = {
      page: fakePage,
      close: async () => {},
    };
    const connector = createCdpConnector(options, {
      connect: async () => session,
    });

    expect(connector.kind).toBe("cdp");
    const connection = await connector.open();

    expect(connection.tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_read",
      "browser_click",
      "browser_type",
    ]);
  });

  test("close() closes the underlying session", async () => {
    let closeCalls = 0;
    const session: BrowserSession = {
      page: fakePage,
      close: async () => {
        closeCalls += 1;
      },
    };
    const connector = createCdpConnector(options, {
      connect: async () => session,
    });

    const connection = await connector.open();
    await connection.close();

    expect(closeCalls).toBe(1);
  });

  test("lets a connect failure through as-is", async () => {
    const cause = new Error("connection refused");
    const connector = createCdpConnector(options, {
      connect: async () => {
        throw cause;
      },
    });

    await expect(connector.open()).rejects.toBe(cause);
  });
});
