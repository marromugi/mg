import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startServer, type StartedServer } from "./start.js";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }
});

const tempDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), "mg-dashboard-"));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  return dir;
};

const start = async (
  options: Parameters<typeof startServer>[0],
): Promise<StartedServer> => {
  const started = await startServer(options);
  cleanups.push(started.close);
  return started;
};

describe("startServer", () => {
  it("returns a launch link on 127.0.0.1 with a one-time token", async () => {
    const started = await start({ dataDir: await tempDir() });

    expect(started.launchLink).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/enter\?token=[A-Za-z0-9_-]+$/,
    );
  });

  it("rejects naming the port when it is already taken", async () => {
    const first = await start({ dataDir: await tempDir() });
    const port = Number(new URL(first.launchLink).port);

    await expect(
      startServer({ dataDir: await tempDir(), port }),
    ).rejects.toThrow(`Cannot listen on 127.0.0.1:${port}`);
  });

  it("rejects naming the folder when the data folder cannot be created", async () => {
    const dir = await tempDir();
    const file = join(dir, "file");
    await writeFile(file, "");

    await expect(
      startServer({ dataDir: join(file, "data") }),
    ).rejects.toThrow(
      `Cannot create the data folder ${join(file, "data")}`,
    );
  });
});
