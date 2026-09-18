import { Client, type ConnectConfig } from "ssh2";
import type { ConnectorContext } from "../types.js";

export type SshConnectorOptions = {
  host: string;
  port?: number;
  username: string;
  auth:
    { privateKey: string; passphrase?: string } | { password: string };
  cwd?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

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
  options: SshConnectorOptions,
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

class Ssh2Client implements SshClient {
  constructor(private readonly connection: Client) {}

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

    return new Promise((resolve, reject) => {
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
          finish(() => reject(execError));
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
          finish(() => reject(streamError));
        });
      });
    });
  }

  async end(): Promise<void> {
    this.connection.end();
  }
}

export const connectSsh = (
  options: SshConnectorOptions,
  context?: ConnectorContext,
): Promise<SshClient> => {
  context?.signal?.throwIfAborted();

  return new Promise((resolve, reject) => {
    let settled = false;
    const connection = new Client();

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
      resolve(new Ssh2Client(connection));
    });

    connection.on("error", (error) => {
      if (settled) return;
      settled = true;
      context?.signal?.removeEventListener("abort", onAbort);
      reject(error);
    });

    connection.connect(toConnectConfig(options));
  });
};
