import { createCredentialAccess } from "@mg/credentials";
import { describe, expect, test } from "vitest";
import { createCdpConnector } from "./index.js";
import type { BrowserPage, BrowserSession } from "./browser.js";
import { ConnectorCloseError, ConnectorOpenError } from "../errors.js";
import { exclusiveNamesOf } from "../exclusive.js";
import { openWorkspace } from "../open.js";
import type { Endpoint } from "../types.js";

const options = {
  url: "http://localhost:9222",
  browser: "build-browser",
};

const fakePage: BrowserPage = {
  navigate: async (url) => ({ url, title: "" }),
  snapshot: async () => "",
  url: async () => "about:blank",
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

  test("declares the given browser name for a URL", () => {
    const connector = createCdpConnector({
      url: "http://localhost:9222",
      browser: "build-browser",
    });

    expect(connector.exclusive).toEqual(["build-browser"]);
  });

  test("declares the given browser name unchanged, spaces kept", () => {
    const connector = createCdpConnector({
      url: "ws://127.0.0.1:9222/devtools/browser/abc",
      browser: " Build Browser ",
    });

    expect(connector.exclusive).toEqual([" Build Browser "]);
  });

  test("throws a TypeError for an empty or blank browser name with a URL", () => {
    for (const browser of ["", "   "]) {
      expect(() =>
        createCdpConnector({ url: "http://localhost:9222", browser }),
      ).toThrow(new TypeError("browser name must not be empty"));
    }
  });

  test("throws the URL's TypeError when the url cannot be parsed", () => {
    for (const browser of ["build-browser", ""]) {
      let thrown: unknown;
      try {
        createCdpConnector({ url: "not a url", browser });
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TypeError);
      expect((thrown as TypeError).message).not.toBe(
        "browser name must not be empty",
      );
    }
  });
});

type FakeEndpoint = Endpoint & {
  opens: number;
  closes: number;
  signals: (AbortSignal | undefined)[];
};

const fakeEndpoint = (
  behaviour: { openError?: Error; closeError?: Error } = {},
  order: string[] = [],
): FakeEndpoint => {
  const endpoint: FakeEndpoint = {
    opens: 0,
    closes: 0,
    signals: [],
    async open(context) {
      endpoint.opens += 1;
      endpoint.signals.push(context?.signal);
      if (behaviour.openError !== undefined) {
        throw behaviour.openError;
      }
      return {
        host: "127.0.0.1",
        port: 45678,
        lost: new AbortController().signal,
        async close() {
          endpoint.closes += 1;
          order.push("endpoint");
          if (behaviour.closeError !== undefined) {
            throw behaviour.closeError;
          }
        },
      };
    },
  };
  return endpoint;
};

const fakeSession = (
  closeError?: Error,
  order: string[] = [],
): BrowserSession => ({
  page: fakePage,
  close: async () => {
    order.push("session");
    if (closeError !== undefined) {
      throw closeError;
    }
  },
});

describe("createCdpConnector with an endpoint", () => {
  test("opens the endpoint once with the same signal and connects to its host and port", async () => {
    const endpoint = fakeEndpoint();
    const urls: string[] = [];
    const connector = createCdpConnector(
      { endpoint, browser: "build-browser" },
      {
        connect: async (connectOptions) => {
          urls.push(connectOptions.url);
          return fakeSession();
        },
      },
    );
    const signal = new AbortController().signal;

    const connection = await connector.open({ signal });

    expect(endpoint.opens).toBe(1);
    expect(endpoint.signals[0]).toBe(signal);
    expect(urls).toEqual(["http://127.0.0.1:45678"]);
    expect(connection.tools.map((tool) => tool.name)).toEqual([
      "browser_navigate",
      "browser_read",
      "browser_click",
      "browser_type",
    ]);
  });

  test("throws the endpoint error as-is and does not connect when the endpoint fails to open", async () => {
    const cause = new Error("endpoint down");
    let connects = 0;
    const connector = createCdpConnector(
      {
        endpoint: fakeEndpoint({ openError: cause }),
        browser: "build-browser",
      },
      {
        connect: async () => {
          connects += 1;
          return fakeSession();
        },
      },
    );

    await expect(connector.open()).rejects.toBe(cause);
    expect(connects).toBe(0);

    const error = await openWorkspace({
      name: "w",
      connectors: [connector],
    }).catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ConnectorOpenError);
    expect((error as ConnectorOpenError).kind).toBe("cdp");
    expect((error as ConnectorOpenError).index).toBe(0);
    expect((error as ConnectorOpenError).cause).toBe(cause);
  });

  test("closes the endpoint once and throws the connect error when the browser refuses", async () => {
    const cause = new Error("cdp refused");
    const endpoint = fakeEndpoint();
    const connector = createCdpConnector(
      { endpoint, browser: "build-browser" },
      {
        connect: async () => {
          throw cause;
        },
      },
    );

    await expect(connector.open()).rejects.toBe(cause);
    expect(endpoint.closes).toBe(1);
  });

  test("still throws the connect error when closing the endpoint fails too", async () => {
    const cause = new Error("cdp refused");
    const endpoint = fakeEndpoint({
      closeError: new Error("close failed"),
    });
    const connector = createCdpConnector(
      { endpoint, browser: "build-browser" },
      {
        connect: async () => {
          throw cause;
        },
      },
    );

    await expect(connector.open()).rejects.toBe(cause);
    expect(endpoint.closes).toBe(1);
  });

  test("closes the session first and the endpoint second", async () => {
    const order: string[] = [];
    const endpoint = fakeEndpoint({}, order);
    const connector = createCdpConnector(
      { endpoint, browser: "build-browser" },
      { connect: async () => fakeSession(undefined, order) },
    );

    const connection = await connector.open();
    await connection.close();

    expect(order).toEqual(["session", "endpoint"]);
    expect(endpoint.closes).toBe(1);
  });

  test("closes the endpoint and throws the session error when only the session fails to close", async () => {
    const cause = new Error("session close");
    const endpoint = fakeEndpoint();
    const connector = createCdpConnector(
      { endpoint, browser: "build-browser" },
      { connect: async () => fakeSession(cause) },
    );

    const connection = await connector.open();

    await expect(connection.close()).rejects.toBe(cause);
    expect(endpoint.closes).toBe(1);
  });

  test("throws the endpoint error when only the endpoint fails to close", async () => {
    const cause = new Error("endpoint close");
    const connector = createCdpConnector(
      {
        endpoint: fakeEndpoint({ closeError: cause }),
        browser: "build-browser",
      },
      { connect: async () => fakeSession() },
    );

    const connection = await connector.open();

    await expect(connection.close()).rejects.toBe(cause);
  });

  test("throws ConnectorCloseError with both errors in order when both fail to close", async () => {
    const sessionError = new Error("session close");
    const endpointError = new Error("endpoint close");
    const connector = createCdpConnector(
      {
        endpoint: fakeEndpoint({ closeError: endpointError }),
        browser: "build-browser",
      },
      { connect: async () => fakeSession(sessionError) },
    );

    const connection = await connector.open();
    const error = await connection.close().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ConnectorCloseError);
    expect((error as ConnectorCloseError).kind).toBe("cdp");
    expect((error as ConnectorCloseError).errors).toEqual([
      sessionError,
      endpointError,
    ]);
    expect((error as ConnectorCloseError).message).toBe(
      'Failed to close connector "cdp"',
    );
  });

  test("declares the given browser name for an endpoint", () => {
    const connector = createCdpConnector({
      endpoint: fakeEndpoint(),
      browser: "build-browser",
    });

    expect(connector.exclusive).toEqual(["build-browser"]);
    expect(
      exclusiveNamesOf({ name: "w", connectors: [connector] }),
    ).toEqual(["build-browser"]);
  });

  test("throws a TypeError for an empty or blank browser name with an endpoint, without opening it", () => {
    for (const browser of ["", "   "]) {
      const endpoint = fakeEndpoint();
      expect(() => createCdpConnector({ endpoint, browser })).toThrow(
        new TypeError("browser name must not be empty"),
      );
      expect(endpoint.opens).toBe(0);
    }
  });

  test("connects to the given URL when given a URL", async () => {
    const urls: string[] = [];
    const connector = createCdpConnector(
      { url: "http://localhost:9222", browser: "build-browser" },
      {
        connect: async (connectOptions) => {
          urls.push(connectOptions.url);
          return fakeSession();
        },
      },
    );

    await connector.open();

    expect(urls).toEqual(["http://localhost:9222"]);
  });
});

describe("createCdpConnector browser tools when the endpoint is lost", () => {
  const reason = new Error(
    "SSH connection to pi-01.local:22 was lost: Keepalive timeout",
  );

  const setup = async (
    script: Partial<BrowserPage> = {},
    lost = new AbortController(),
  ) => {
    let calls = 0;
    const page: BrowserPage = {
      navigate: async (url) => {
        calls += 1;
        return { url, title: "" };
      },
      snapshot: async () => {
        calls += 1;
        return "";
      },
      url: async () => {
        calls += 1;
        return "about:blank";
      },
      click: async () => {
        calls += 1;
      },
      type: async () => {
        calls += 1;
      },
      ...script,
    };
    const endpoint: Endpoint = {
      async open() {
        return {
          host: "127.0.0.1",
          port: 45678,
          lost: lost.signal,
          close: async () => {},
        };
      },
    };
    const connector = createCdpConnector(
      {
        endpoint,
        browser: "build-browser",
        credentials: createCredentialAccess({
          store: { read: async () => "hunter2abc" },
          entries: [
            {
              name: "demo",
              origins: ["http://127.0.0.1:8787"],
              fields: ["password"],
            },
          ],
          approval: { needed: false },
        }),
      },
      { connect: async () => ({ page, close: async () => {} }) },
    );
    const connection = await connector.open();
    const run = async (name: string, input: object) => {
      const tool = connection.tools.find((t) => t.name === name)!;
      return (await tool.prepare(input)).run({});
    };
    return { run, lost, calls: () => calls };
  };

  test("every browser tool rejects with the reason without calling the page", async () => {
    const { run, lost, calls } = await setup();
    lost.abort(reason);

    for (const [name, input] of [
      ["browser_navigate", { url: "https://example.com" }],
      ["browser_read", {}],
      ["browser_click", { role: "button", name: "Go" }],
      ["browser_type", { role: "textbox", name: "Search", text: "hi" }],
      ["browser_credentials", {}],
      [
        "browser_fill_credential",
        {
          role: "textbox",
          name: "Password",
          credential: "demo",
          field: "password",
        },
      ],
    ] as const) {
      await expect(run(name, input)).rejects.toBe(reason);
    }
    expect(calls()).toBe(0);
  });

  test("a page failure after the loss rejects with the reason", async () => {
    const lost = new AbortController();
    const { run } = await setup(
      {
        click: async () => {
          lost.abort(reason);
          throw new Error(
            "Target page, context or browser has been closed",
          );
        },
      },
      lost,
    );

    await expect(
      run("browser_click", { role: "button", name: "Go" }),
    ).rejects.toBe(reason);
  });

  test("a page failure without a loss rejects with the page error", async () => {
    const pageError = new Error("Timeout 30000ms exceeded");
    const { run } = await setup({
      click: async () => {
        throw pageError;
      },
    });

    await expect(
      run("browser_click", { role: "button", name: "Go" }),
    ).rejects.toBe(pageError);
  });
});
