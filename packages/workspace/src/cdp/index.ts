import {
  connectCdp,
  type BrowserSession,
  type CdpConnectorOptions,
} from "./browser.js";
import { createBrowserTools } from "./tools.js";
import { ConnectorCloseError } from "../errors.js";
import type { Connection, Connector } from "../types.js";

export type { CdpConnectorOptions } from "./browser.js";

const urlOf = (host: string, port: number): string =>
  `http://${host.includes(":") ? `[${host}]` : host}:${port}`;

export const createCdpConnector = (
  options: CdpConnectorOptions,
  deps?: { connect?: typeof connectCdp },
): Connector => {
  const connect = deps?.connect ?? connectCdp;
  const { endpoint, timeoutMs } = options;
  if (endpoint === undefined) {
    void new URL(options.url);
  }
  if (options.browser.trim() === "") {
    throw new TypeError("browser name must not be empty");
  }
  const exclusive = [options.browser];
  const connectionOf = (
    session: BrowserSession,
    close: () => Promise<void>,
  ): Connection => ({
    tools: createBrowserTools(session.page, {
      maxOutputBytes: options.maxOutputBytes,
    }),
    close,
  });

  if (endpoint === undefined) {
    const url = options.url;
    return {
      kind: "cdp",
      exclusive,
      async open(context) {
        const session = await connect({ url, timeoutMs }, context);
        return connectionOf(session, () => session.close());
      },
    };
  }

  return {
    kind: "cdp",
    exclusive,
    async open(context) {
      const opened = await endpoint.open(context);
      let session: BrowserSession;
      try {
        session = await connect(
          { url: urlOf(opened.host, opened.port), timeoutMs },
          context,
        );
      } catch (error) {
        try {
          await opened.close();
        } catch {
          // つなぐ失敗を投げるのが優先なので、閉じる失敗は捨てます。
        }
        throw error;
      }
      const connected = session;
      return connectionOf(connected, async () => {
        const errors: unknown[] = [];
        try {
          await connected.close();
        } catch (error) {
          errors.push(error);
        }
        try {
          await opened.close();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) {
          throw errors[0];
        }
        if (errors.length === 2) {
          throw new ConnectorCloseError("cdp", errors);
        }
      });
    },
  };
};
