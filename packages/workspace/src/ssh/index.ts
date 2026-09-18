import { connectSsh, type SshConnectorOptions } from "./client.js";
import { createShellTool } from "./tool.js";
import type { Connector } from "../types.js";

export type { SshConnectorOptions } from "./client.js";

export const createSshConnector = (
  options: SshConnectorOptions,
  deps?: { connect?: typeof connectSsh },
): Connector => {
  const connect = deps?.connect ?? connectSsh;

  return {
    kind: "ssh",
    async open(context) {
      const client = await connect(options, context);
      const tool = createShellTool(client, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: options.maxOutputBytes,
      });
      return {
        tools: [tool],
        close: () => client.end(),
      };
    },
  };
};
