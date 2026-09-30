import net from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { NothingListeningError } from "../errors.js";
import { createSshEndpoint } from "./endpoint.js";
import type { ForwardResult, SshForwarder } from "./client.js";

const base = {
  host: "pi-01.local",
  username: "marromugi",
  auth: { password: "secret" },
  remotePort: 9333,
};

const fakeForwarder = (
  respond: (call: number) => ForwardResult | Error,
) => {
  const forwards: { host: string; port: number }[] = [];
  const state = { ends: 0 };
  const forwarder: SshForwarder = {
    lost: new AbortController().signal,
    async forwardOut(host, port) {
      forwards.push({ host, port });
      const result = respond(forwards.length);
      if (result instanceof Error) throw result;
      return result;
    },
    async end() {
      state.ends += 1;
    },
  };
  return { forwarder, forwards, state };
};

const dial = (port: number): Promise<net.Socket> =>
  new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    socket.once("connect", () => resolve(socket));
    socket.once("error", reject);
  });

const readOnce = (socket: net.Socket): Promise<string> =>
  new Promise((resolve) =>
    socket.once("data", (data) => resolve(data.toString())),
  );

const closed = (socket: net.Socket): Promise<void> =>
  new Promise((resolve) => {
    if (socket.destroyed) resolve();
    else socket.once("close", () => resolve());
  });

const opens = (): ForwardResult => ({
  kind: "open",
  stream: new PassThrough(),
});

describe("createSshEndpoint", () => {
  test("returns 127.0.0.1 and a port that reaches the remote port through the forward", async () => {
    const fake = fakeForwarder(opens);
    const endpoint = createSshEndpoint(base, {
      connect: async () => fake.forwarder,
    });

    const opened = await endpoint.open();
    try {
      expect(opened.host).toBe("127.0.0.1");
      expect(Number.isInteger(opened.port)).toBe(true);
      expect(opened.port).toBeGreaterThanOrEqual(1);

      const socket = await dial(opened.port);
      socket.write("ping");
      expect(await readOnce(socket)).toBe("ping");
      socket.destroy();

      expect(fake.forwards.length).toBeGreaterThan(0);
      for (const forward of fake.forwards) {
        expect(forward).toEqual({ host: "127.0.0.1", port: 9333 });
      }
    } finally {
      await opened.close();
    }
  });

  test("fails with NothingListeningError and closes the connection when the remote port refuses", async () => {
    const refused = new Error("refused");
    const fake = fakeForwarder(() => ({
      kind: "refused",
      cause: refused,
    }));
    const endpoint = createSshEndpoint(base, {
      connect: async () => fake.forwarder,
    });

    const error = await endpoint.open().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(NothingListeningError);
    expect((error as Error).message).toBe(
      "nothing is listening on 127.0.0.1:9333 on pi-01.local",
    );
    expect((error as Error).cause).toBe(refused);
    expect(fake.state.ends).toBe(1);
  });

  test("throws the forwarder's own error and closes the connection when the forward fails for another reason", async () => {
    const failure = new Error("forward failed");
    const fake = fakeForwarder(() => failure);
    const endpoint = createSshEndpoint(base, {
      connect: async () => fake.forwarder,
    });

    const error = await endpoint.open().catch((e: unknown) => e);

    expect(error).toBe(failure);
    expect(fake.state.ends).toBe(1);
  });

  test("throws the connect error as-is", async () => {
    const failure = new Error("auth failed");
    const endpoint = createSshEndpoint(base, {
      connect: async () => {
        throw failure;
      },
    });

    const error = await endpoint.open().catch((e: unknown) => e);

    expect(error).toBe(failure);
  });

  test("close() cuts open connections, stops listening, and ends the connection once", async () => {
    const fake = fakeForwarder(opens);
    const endpoint = createSshEndpoint(base, {
      connect: async () => fake.forwarder,
    });
    const opened = await endpoint.open();
    const socket = await dial(opened.port);
    const cut = closed(socket);

    await opened.close();
    await cut;

    expect(fake.state.ends).toBe(1);
    await expect(dial(opened.port)).rejects.toMatchObject({
      code: "ECONNREFUSED",
    });

    await opened.close();
    expect(fake.state.ends).toBe(1);
  });

  test("cuts only the connection whose forward is refused and serves the next one", async () => {
    const fake = fakeForwarder((call) =>
      call === 2
        ? { kind: "refused", cause: new Error("refused") }
        : opens(),
    );
    const endpoint = createSshEndpoint(base, {
      connect: async () => fake.forwarder,
    });
    const opened = await endpoint.open();
    try {
      const first = await dial(opened.port);
      await closed(first);

      const second = await dial(opened.port);
      second.write("ping");
      expect(await readOnce(second)).toBe("ping");
      second.destroy();
    } finally {
      await opened.close();
    }
  });

  test("throws the signal's reason without connecting when already aborted", async () => {
    let connects = 0;
    const endpoint = createSshEndpoint(base, {
      connect: async () => {
        connects += 1;
        return fakeForwarder(opens).forwarder;
      },
    });
    const reason = new Error("stop");
    const controller = new AbortController();
    controller.abort(reason);

    const error = await endpoint
      .open({ signal: controller.signal })
      .catch((e: unknown) => e);

    expect(error).toBe(reason);
    expect(connects).toBe(0);
  });
});
