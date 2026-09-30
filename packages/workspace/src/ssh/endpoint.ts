import net from "node:net";
import type { Duplex } from "node:stream";
import {
  connectSshForwarder,
  type SshConnectionLoss,
  type SshConnectionOptions,
  type SshForwarder,
} from "./client.js";
import {
  EndpointCloseError,
  NothingListeningError,
  SshConnectionLostError,
} from "../errors.js";
import type { Endpoint, OpenEndpoint } from "../types.js";

export type SshEndpointOptions = SshConnectionOptions & {
  remoteHost?: string;
  remotePort: number;
};

const DEFAULT_REMOTE_HOST = "127.0.0.1";
const LOCAL_HOST = "127.0.0.1";
const DEFAULT_SSH_PORT = 22;

const listen = (server: net.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host: LOCAL_HOST, port: 0 }, () => {
      server.off("error", reject);
      const address = server.address();
      if (address === null || typeof address === "string") {
        reject(new Error("listener has no port"));
        return;
      }
      resolve(address.port);
    });
  });

const closeServer = (server: net.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const bridge = (socket: net.Socket, stream: Duplex): void => {
  socket.on("close", () => stream.destroy());
  stream.on("close", () => socket.destroy());
  stream.on("error", () => socket.destroy());
  socket.pipe(stream);
  stream.pipe(socket);
};

export const createSshEndpoint = (
  options: SshEndpointOptions,
  deps?: {
    connect?: typeof connectSshForwarder;
    createServer?: typeof net.createServer;
  },
): Endpoint => {
  const connect = deps?.connect ?? connectSshForwarder;
  const createServer = deps?.createServer ?? net.createServer;
  const sshPort = options.port ?? DEFAULT_SSH_PORT;
  const remoteHost = options.remoteHost ?? DEFAULT_REMOTE_HOST;
  const { remotePort } = options;

  const serve = (
    forwarder: SshForwarder,
    sockets: Set<net.Socket>,
  ): net.Server => {
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      socket.on("error", () => socket.destroy());
      forwarder.forwardOut(remoteHost, remotePort).then(
        (result) => {
          if (result.kind === "refused" || socket.destroyed) {
            if (result.kind === "open") result.stream.destroy();
            socket.destroy();
            return;
          }
          bridge(socket, result.stream);
        },
        () => socket.destroy(),
      );
    });
    return server;
  };

  return {
    async open(context): Promise<OpenEndpoint> {
      context?.signal?.throwIfAborted();
      const forwarder = await connect(options, context);
      const lossError = (): SshConnectionLostError =>
        new SshConnectionLostError(
          options.host,
          sshPort,
          forwarder.lost.reason as SshConnectionLoss,
        );
      const untilLost = <T>(work: Promise<T>): Promise<T> =>
        new Promise<T>((resolve, reject) => {
          const onLost = () => reject(lossError());
          if (forwarder.lost.aborted) {
            onLost();
            work.catch(() => {});
            return;
          }
          forwarder.lost.addEventListener("abort", onLost, {
            once: true,
          });
          work
            .then(resolve, reject)
            .finally(() =>
              forwarder.lost.removeEventListener("abort", onLost),
            );
        });

      const sockets = new Set<net.Socket>();
      let server: net.Server | undefined;
      let port: number;
      try {
        const probe = await untilLost(
          forwarder.forwardOut(remoteHost, remotePort),
        );
        if (probe.kind === "refused") {
          throw new NothingListeningError(
            remoteHost,
            remotePort,
            options.host,
            { cause: probe.cause },
          );
        }
        probe.stream.destroy();
        server = serve(forwarder, sockets);
        port = await untilLost(listen(server));
        server.on("error", () => {});
        if (forwarder.lost.aborted) throw lossError();
        context?.signal?.throwIfAborted();
      } catch (error) {
        server?.close();
        try {
          await forwarder.end();
        } catch {
          // 開く失敗を投げるのが優先なので、閉じる失敗は捨てます。
        }
        throw error;
      }

      const listener = server;
      const lost = new AbortController();
      let closeCalled = false;
      let stopping: Promise<void> | undefined;
      const stopListener = (): Promise<void> =>
        (stopping ??= closeServer(listener));

      forwarder.lost.addEventListener(
        "abort",
        () => {
          if (closeCalled) return;
          lost.abort(lossError());
          // 失敗は close() が同じ停止を待って受け取ります。
          stopListener().catch(() => {});
          for (const socket of sockets) socket.destroy();
        },
        { once: true },
      );

      let closing: Promise<void> | undefined;
      const close = async (): Promise<void> => {
        closeCalled = true;
        const errors: unknown[] = [];
        const stopped = stopListener();
        for (const socket of sockets) socket.destroy();
        try {
          await stopped;
        } catch (error) {
          errors.push(error);
        }
        try {
          await forwarder.end();
        } catch (error) {
          errors.push(error);
        }
        if (errors.length === 1) throw errors[0];
        if (errors.length > 1) throw new EndpointCloseError(errors);
      };

      return {
        host: LOCAL_HOST,
        port,
        lost: lost.signal,
        close: () => (closing ??= close()),
      };
    },
  };
};
