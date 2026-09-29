import net from "node:net";
import type { Duplex } from "node:stream";
import {
  connectSshForwarder,
  type SshConnectionOptions,
  type SshForwarder,
} from "./client.js";
import { NothingListeningError } from "../errors.js";
import type { Endpoint, OpenEndpoint } from "../types.js";

export type SshEndpointOptions = SshConnectionOptions & {
  remoteHost?: string;
  remotePort: number;
};

const DEFAULT_SSH_PORT = 22;
const DEFAULT_REMOTE_HOST = "127.0.0.1";
const LOCAL_HOST = "127.0.0.1";

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
  deps?: { connect?: typeof connectSshForwarder },
): Endpoint => {
  const connect = deps?.connect ?? connectSshForwarder;
  const remoteHost = options.remoteHost ?? DEFAULT_REMOTE_HOST;
  const { remotePort } = options;

  const serve = (
    forwarder: SshForwarder,
    sockets: Set<net.Socket>,
  ): net.Server => {
    const server = net.createServer((socket) => {
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
    exclusive: [
      `ssh-forward:${options.host}:${options.port ?? DEFAULT_SSH_PORT}:${remoteHost}:${remotePort}`,
    ],
    async open(context): Promise<OpenEndpoint> {
      context?.signal?.throwIfAborted();
      const forwarder = await connect(options, context);
      const sockets = new Set<net.Socket>();
      let server: net.Server | undefined;
      let port: number;
      try {
        const probe = await forwarder.forwardOut(
          remoteHost,
          remotePort,
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
        port = await listen(server);
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
      let closing: Promise<void> | undefined;
      const close = async (): Promise<void> => {
        const errors: unknown[] = [];
        const stopped = closeServer(listener);
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
        if (errors.length > 0) throw errors[0];
      };

      return {
        host: LOCAL_HOST,
        port,
        close: () => (closing ??= close()),
      };
    },
  };
};
