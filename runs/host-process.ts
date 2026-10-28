import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const started = new Set<ChildProcess>();

/** A port nothing listens on now. */
export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() =>
        typeof address === "object" && address !== null
          ? resolve(address.port)
          : reject(new Error("no port")),
      );
    });
  });

export const stopChild = (child: ChildProcess): Promise<void> =>
  new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
  });

/** Stops every server this module started. */
export const stopAllServers = async (): Promise<void> => {
  await Promise.all([...started].map(stopChild));
};

/**
 * Starts `runs/host-server.ts` and resolves once it listens.
 * `onOutput` gets everything it prints. The caller stops the child.
 */
export const startServer = (
  port: number,
  dataDir: string,
  tokensFile: string,
  onOutput: (text: string) => void = () => undefined,
): Promise<ChildProcess> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        "--env-file-if-exists=.env",
        "runs/host-server.ts",
        "--port",
        String(port),
        "--data-dir",
        dataDir,
        "--tokens",
        tokensFile,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    started.add(child);
    let output = "";
    const onData = (chunk: Buffer): void => {
      const text = chunk.toString();
      onOutput(text);
      output += text;
      if (output.includes("listening on")) {
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.once("exit", (code) =>
      reject(
        new Error(
          `the server exited with ${code} before listening:\n${output}`,
        ),
      ),
    );
  });
