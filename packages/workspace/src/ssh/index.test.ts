import { describe, expect, test } from "vitest";
import { createSshConnector } from "./index.js";
import type { SshClient } from "./client.js";

const options = {
  host: "example.com",
  username: "deploy",
  auth: { password: "secret" },
};

describe("createSshConnector", () => {
  test("kind is ssh and open() returns one shell tool", async () => {
    const client: SshClient = {
      exec: async () => ({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
        truncated: false,
      }),
      end: async () => {},
    };
    const connector = createSshConnector(options, {
      connect: async () => client,
    });

    expect(connector.kind).toBe("ssh");
    const connection = await connector.open();

    expect(connection.tools).toHaveLength(1);
    expect(connection.tools[0].name).toBe("shell");
  });

  test("close() ends the underlying client", async () => {
    let endCalls = 0;
    const client: SshClient = {
      exec: async () => ({
        stdout: "",
        stderr: "",
        code: 0,
        signal: null,
        timedOut: false,
        truncated: false,
      }),
      end: async () => {
        endCalls += 1;
      },
    };
    const connector = createSshConnector(options, {
      connect: async () => client,
    });

    const connection = await connector.open();
    await connection.close();

    expect(endCalls).toBe(1);
  });

  test("lets a connect failure through as-is", async () => {
    const cause = new Error("connection refused");
    const connector = createSshConnector(options, {
      connect: async () => {
        throw cause;
      },
    });

    await expect(connector.open()).rejects.toBe(cause);
  });
});
