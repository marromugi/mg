import type { Duplex } from "node:stream";
import { Client, type ConnectConfig } from "ssh2";
import { SshConnectionLostError } from "../errors.js";
import type { ConnectorContext } from "../types.js";

export type SshConnectionOptions = {
  host: string;
  port?: number;
  username: string;
  auth:
    { privateKey: string; passphrase?: string } | { password: string };
};

export type SshConnectorOptions = SshConnectionOptions & {
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

export type ForwardResult =
  | { kind: "open"; stream: Duplex }
  | { kind: "refused"; cause: unknown };

export type SshConnectionLoss =
  { kind: "failed"; cause: unknown } | { kind: "closed" };

export interface SshForwarder {
  // Resolves "refused" for a refused channel; rejects on any other failure.
  forwardOut(dstHost: string, dstPort: number): Promise<ForwardResult>;
  // Aborts when the connection closes other than through end(), before
  // any stream from forwardOut reports its end because of that close.
  // The reason is a SshConnectionLoss.
  readonly lost: AbortSignal;
  // Resolves at once after lost has aborted.
  end(): Promise<void>;
}

export type SshExecResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
};

export interface SshClient {
  exec(
    command: string,
    options: {
      timeoutMs: number;
      maxOutputBytes: number;
      signal?: AbortSignal;
    },
  ): Promise<SshExecResult & { timedOut: boolean; truncated: boolean }>;
  end(): Promise<void>;
}

const DEFAULT_PORT = 22;

const abortError = (signal: AbortSignal): unknown =>
  signal.reason ??
  new DOMException("The operation was aborted", "AbortError");

const toConnectConfig = (
  options: SshConnectionOptions,
): ConnectConfig => {
  const base: ConnectConfig = {
    host: options.host,
    port: options.port ?? DEFAULT_PORT,
    username: options.username,
  };
  return "password" in options.auth
    ? { ...base, password: options.auth.password }
    : {
        ...base,
        privateKey: options.auth.privateKey,
        passphrase: options.auth.passphrase,
      };
};

class Sink {
  private readonly chunks: Buffer[] = [];
  size = 0;

  append(data: Buffer, maxOutputBytes: number): boolean {
    const remaining = maxOutputBytes - this.size;
    if (remaining <= 0) {
      return true;
    }
    const slice =
      data.byteLength > remaining ? data.subarray(0, remaining) : data;
    this.chunks.push(Buffer.from(slice));
    this.size += slice.byteLength;
    return slice.byteLength < data.byteLength;
  }

  toText(): string {
    return Buffer.concat(this.chunks).toString("utf8");
  }
}

// Aborts `lost` with an SshConnectionLoss when the connection closes
// before ending() was called.
const watchConnection = (
  connection: Pick<Client, "on">,
): { lost: AbortSignal; ending: () => void } => {
  const lost = new AbortController();
  let ended = false;
  let lastError: { cause: unknown } | undefined;

  connection.on("error", (error: unknown) => {
    lastError = { cause: error };
  });
  connection.on("close", () => {
    if (ended) return;
    const loss: SshConnectionLoss =
      lastError === undefined
        ? { kind: "closed" }
        : { kind: "failed", cause: lastError.cause };
    lost.abort(loss);
  });

  return {
    lost: lost.signal,
    ending: () => {
      ended = true;
    },
  };
};

class Ssh2Client implements SshClient {
  private readonly watch: ReturnType<typeof watchConnection>;

  constructor(
    private readonly connection: Client,
    private readonly sshHost: string,
    private readonly sshPort: number = DEFAULT_PORT,
  ) {
    this.watch = watchConnection(connection);
  }

  private lostError(): SshConnectionLostError {
    return new SshConnectionLostError(
      this.sshHost,
      this.sshPort,
      this.watch.lost.reason as SshConnectionLoss,
    );
  }

  exec(
    command: string,
    options: {
      timeoutMs: number;
      maxOutputBytes: number;
      signal?: AbortSignal;
    },
  ): Promise<
    SshExecResult & { timedOut: boolean; truncated: boolean }
  > {
    options.signal?.throwIfAborted();
    if (this.watch.lost.aborted) {
      return Promise.reject(this.lostError());
    }

    return new Promise((resolve, reject) => {
      const failure = (error: unknown): unknown =>
        this.watch.lost.aborted ? this.lostError() : error;
      let settled = false;
      let timedOut = false;
      let truncated = false;
      let code: number | null = null;
      let signal: string | null = null;
      let stream: import("ssh2").ClientChannel | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const stdout = new Sink();
      const stderr = new Sink();

      const finish = (settle: () => void): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        settle();
      };

      const onAbort = (): void => {
        const signalRef = options.signal;
        if (signalRef === undefined) return;
        stream?.close();
        finish(() => reject(abortError(signalRef)));
      };

      options.signal?.addEventListener("abort", onAbort, {
        once: true,
      });

      this.connection.exec(command, (execError, execStream) => {
        if (execError) {
          finish(() => reject(failure(execError)));
          return;
        }
        if (settled) {
          execStream.close();
          return;
        }
        stream = execStream;

        timer = setTimeout(() => {
          timedOut = true;
          execStream.close();
        }, options.timeoutMs);

        execStream.on("data", (data: Buffer) => {
          if (truncated) return;
          if (stdout.append(data, options.maxOutputBytes)) {
            truncated = true;
            execStream.close();
          }
        });
        execStream.stderr.on("data", (data: Buffer) => {
          if (truncated) return;
          if (stderr.append(data, options.maxOutputBytes)) {
            truncated = true;
            execStream.close();
          }
        });

        execStream.on("exit", (exitCode: number) => {
          code = exitCode;
        });
        execStream.on("exit", (_exitCode: null, exitSignal: string) => {
          if (typeof exitSignal === "string") {
            signal = exitSignal;
          }
        });

        execStream.on("close", () => {
          if (this.watch.lost.aborted) {
            finish(() => reject(this.lostError()));
            return;
          }
          if (
            code === null &&
            signal === null &&
            !timedOut &&
            !truncated
          ) {
            finish(() =>
              reject(
                new Error("SSH channel closed without an exit status"),
              ),
            );
            return;
          }
          finish(() =>
            resolve({
              stdout: stdout.toText(),
              stderr: stderr.toText(),
              code,
              signal,
              timedOut,
              truncated,
            }),
          );
        });

        execStream.on("error", (streamError: Error) => {
          finish(() => reject(failure(streamError)));
        });
      });
    });
  }

  async end(): Promise<void> {
    if (this.watch.lost.aborted) return;
    this.watch.ending();
    this.connection.end();
  }
}

const KEEPALIVE: ConnectConfig = {
  keepaliveInterval: 15000,
  keepaliveCountMax: 3,
};

const openConnection = (
  options: SshConnectionOptions,
  context?: ConnectorContext,
  extra?: { createClient?: () => Client },
): Promise<Client> => {
  context?.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    let settled = false;
    const connection = (extra?.createClient ?? (() => new Client()))();

    const onAbort = (): void => {
      const signalRef = context?.signal;
      if (signalRef === undefined || settled) return;
      settled = true;
      connection.end();
      reject(abortError(signalRef));
    };

    context?.signal?.addEventListener("abort", onAbort, { once: true });

    connection.on("ready", () => {
      if (settled) return;
      settled = true;
      context?.signal?.removeEventListener("abort", onAbort);
      resolve(connection);
    });

    connection.on("error", (error) => {
      if (settled) return;
      settled = true;
      context?.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    connection.connect({
      ...toConnectConfig(options),
      ...KEEPALIVE,
    });
  });
};

export const connectSsh = async (
  options: SshConnectorOptions,
  context?: ConnectorContext,
  deps?: { createClient?: () => Client },
): Promise<SshClient> =>
  new Ssh2Client(
    await openConnection(options, context, {
      createClient: deps?.createClient,
    }),
    options.host,
    options.port,
  );

// ssh2 CHANNEL_OPEN_FAILURE.CONNECT_FAILED, worded "Connection refused"
const isRefused = (error: Error): boolean =>
  (error as { reason?: unknown }).reason === 2 &&
  error.message.includes("Connection refused");

export const toSshForwarder = (
  connection: Pick<Client, "forwardOut" | "end" | "on" | "once">,
): SshForwarder => {
  const { lost, ending } = watchConnection(connection);

  return {
    lost,
    forwardOut: (dstHost, dstPort) =>
      new Promise((resolve, reject) => {
        connection.forwardOut(
          "127.0.0.1",
          0,
          dstHost,
          dstPort,
          (error, stream) => {
            if (error === undefined) {
              resolve({ kind: "open", stream });
            } else if (isRefused(error)) {
              resolve({ kind: "refused", cause: error });
            } else {
              reject(error);
            }
          },
        );
      }),
    end: () =>
      new Promise((resolve) => {
        if (lost.aborted) {
          resolve();
          return;
        }
        ending();
        connection.once("close", () => resolve());
        connection.end();
      }),
  };
};

export const connectSshForwarder = async (
  options: SshConnectionOptions,
  context?: ConnectorContext,
  deps?: { createClient?: () => Client },
): Promise<SshForwarder> =>
  toSshForwarder(
    await openConnection(options, context, {
      createClient: deps?.createClient,
    }),
  );
