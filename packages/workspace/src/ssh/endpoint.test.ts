import net from "node:net";
import { PassThrough } from "node:stream";
import { describe, expect, test, vi } from "vitest";
import {
  EndpointCloseError,
  NothingListeningError,
  SshConnectionLostError,
} from "../errors.js";
import { createSshEndpoint } from "./endpoint.js";
import type { ForwardResult, SshForwarder } from "./client.js";

const base = {
  host: "pi-01.local",
  username: "marromugi",
  auth: { password: "secret" },
  remotePort: 9333,
};

const fakeForwarder = (
  respond: (call: number) => ForwardResult | Error | "never",
  drop = new AbortController(),
) => {
  const forwards: { host: string; port: number }[] = [];
  const state = { ends: 0 };
  const forwarder: SshForwarder = {
    lost: drop.signal,
    async forwardOut(host, port) {
      forwards.push({ host, port });
      const result = respond(forwards.length);
      if (result === "never")
        return new Promise<ForwardResult>(() => {});
      if (result instanceof Error) throw result;
      return result;
    },
    async end() {
      state.ends += 1;
    },
  };
  return { forwarder, forwards, state, drop };
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

  describe("when the SSH connection is lost", () => {
    const keepalive = new Error("Keepalive timeout");
    const closedLoss = { kind: "closed" } as const;
    const closedMessage =
      "SSH connection to pi-01.local:22 was closed by the other side or the network";

    const openWith = async (
      respond: (
        call: number,
      ) => ForwardResult | Error | "never" = opens,
      createServer?: typeof net.createServer,
    ) => {
      const fake = fakeForwarder(respond);
      const endpoint = createSshEndpoint(base, {
        connect: async () => fake.forwarder,
        createServer,
      });
      return { fake, opened: await endpoint.open() };
    };

    test("lost aborts at once with the reason for a failed and for a closed connection", async () => {
      const failed = await openWith();
      failed.fake.drop.abort({ kind: "failed", cause: keepalive });
      expect(failed.opened.lost.aborted).toBe(true);
      const reason = failed.opened.lost
        .reason as SshConnectionLostError;
      expect(reason.name).toBe("SshConnectionLostError");
      expect(reason.message).toBe(
        "SSH connection to pi-01.local:22 was lost: Keepalive timeout",
      );
      expect(reason.cause).toBe(keepalive);

      const other = await openWith();
      other.fake.drop.abort(closedLoss);
      const otherReason = other.opened.lost
        .reason as SshConnectionLostError;
      expect(otherReason.message).toBe(closedMessage);
      expect(otherReason.cause).toBeUndefined();
    });

    test("lost has aborted before a later listener on the connection ends a bridged stream", async () => {
      const stream = new PassThrough();
      const { fake, opened } = await openWith((call) =>
        call === 1 ? opens() : { kind: "open", stream },
      );
      const socket = await dial(opened.port);
      socket.write("ping");
      expect(await readOnce(socket)).toBe("ping");
      let seen: boolean | undefined;
      fake.drop.signal.addEventListener("abort", () => {
        seen = opened.lost.aborted;
        stream.end();
        stream.destroy();
      });

      fake.drop.abort(closedLoss);

      expect(seen).toBe(true);
      await closed(socket);
    });

    test("refuses new connections and closes every accepted one, even one whose forward never settles", async () => {
      const streams: (() => ReturnType<typeof opens> | "never")[] = [
        opens,
        opens,
        () => "never",
      ];
      const { fake, opened } = await openWith((call) =>
        streams[call - 1](),
      );
      const first = await dial(opened.port);
      const second = await dial(opened.port);
      const cuts = [closed(first), closed(second)];

      fake.drop.abort(closedLoss);
      await Promise.all(cuts);

      await expect(dial(opened.port)).rejects.toMatchObject({
        code: "ECONNREFUSED",
      });
    });

    test("close() resolves, ends the connection once, and keeps the reason", async () => {
      const { fake, opened } = await openWith();
      fake.drop.abort(closedLoss);
      const reason = opened.lost.reason;

      await opened.close();
      expect(fake.state.ends).toBe(1);
      expect(opened.lost.reason).toBe(reason);

      await opened.close();
      expect(fake.state.ends).toBe(1);
    });

    test("open() rejects with the loss and ends the connection once when the probe is pending", async () => {
      const fake = fakeForwarder(() => "never");
      const endpoint = createSshEndpoint(base, {
        connect: async () => fake.forwarder,
      });

      const pending = endpoint.open().catch((e: unknown) => e);
      await vi.waitFor(() => expect(fake.forwards.length).toBe(1));
      fake.drop.abort(closedLoss);
      const error = await pending;

      expect(error).toBeInstanceOf(SshConnectionLostError);
      expect((error as Error).message).toBe(closedMessage);
      expect(fake.state.ends).toBe(1);
    });

    test("a loss while close() is running does not abort lost or fail the close", async () => {
      const { fake, opened } = await openWith();

      const closing = opened.close();
      fake.drop.abort({ kind: "failed", cause: keepalive });
      await closing;

      expect(opened.lost.aborted).toBe(false);
      expect(fake.state.ends).toBe(1);
    });

    const failingServer = (
      error: Error,
      calls: { closes: number },
    ): typeof net.createServer =>
      ((...args: Parameters<typeof net.createServer>) => {
        const server = net.createServer(...args);
        const realClose = server.close.bind(server);
        server.close = (callback?: (e?: Error) => void) => {
          calls.closes += 1;
          realClose();
          callback?.(error);
          return server;
        };
        return server;
      }) as typeof net.createServer;

    test("close() fails with both errors when stopping the listener and ending the connection fail", async () => {
      const listenerError = new Error("listener stuck");
      const sshError = new Error("ssh end failed");
      const { fake, opened } = await openWith(
        opens,
        failingServer(listenerError, { closes: 0 }),
      );
      fake.forwarder.end = async () => {
        throw sshError;
      };

      const error = (await opened
        .close()
        .catch((e: unknown) => e)) as EndpointCloseError;

      expect(error.name).toBe("EndpointCloseError");
      expect(error.message).toBe("Failed to close endpoint");
      expect(error.errors).toEqual([listenerError, sshError]);
      expect(error.errors[0]).toBe(listenerError);
      expect(error.errors[1]).toBe(sshError);
      expect(error.cause).toBe(listenerError);
    });

    test("close() fails with the listener's error as-is and stops the listener once after a loss", async () => {
      const listenerError = new Error("listener stuck");
      const calls = { closes: 0 };
      const { fake, opened } = await openWith(
        opens,
        failingServer(listenerError, calls),
      );
      fake.drop.abort(closedLoss);

      const error = await opened.close().catch((e: unknown) => e);

      expect(error).toBe(listenerError);
      expect(calls.closes).toBe(1);
    });
  });
});
