import { connectCdp, type CdpConnectorOptions } from "./browser.js";
import { createBrowserTools } from "./tools.js";
import type { Connector } from "../types.js";

export type { CdpConnectorOptions } from "./browser.js";

export const createCdpConnector = (
  options: CdpConnectorOptions,
  deps?: { connect?: typeof connectCdp },
): Connector => {
  const connect = deps?.connect ?? connectCdp;
  const exclusive = [`cdp:${new URL(options.url).host}`];

  return {
    kind: "cdp",
    exclusive,
    async open(context) {
      const session = await connect(options, context);
      const tools = createBrowserTools(session.page, {
        maxOutputBytes: options.maxOutputBytes,
      });
      return {
        tools,
        close: () => session.close(),
      };
    },
  };
};
