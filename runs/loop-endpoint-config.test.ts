import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RunConfig } from "@mg/runner";
import { exclusiveNamesOf } from "@mg/workspace";
import type { Workspace } from "@mg/workspace";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

let dir: string;
let sshKeyPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "mg-endpoint-config-test-"));
  sshKeyPath = join(dir, "id_ed25519");
  writeFileSync(sshKeyPath, "placeholder");
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("OPENROUTER_API_KEY", "placeholder");
  vi.stubEnv("MG_SSH_HOST", "pi-01.local");
  vi.stubEnv("MG_SSH_USER", "marromugi");
  vi.stubEnv("MG_SSH_KEY_PATH", sshKeyPath);
  vi.stubEnv("MG_CDP_PORT", "9333");
  vi.stubEnv("MG_CLEAN_CDP_PORT", "9334");
  delete process.env.MG_CDP_URL;
  delete process.env.MG_CLEAN_CDP_URL;
});

const loadWorkspace = async (): Promise<RunConfig> =>
  (await import("./loop-workspace.config.ts")).default;

const loadSubagent = async (): Promise<RunConfig> =>
  (await import("./loop-subagent.config.ts")).default;

const badPorts = ["abc", "0", "65536", "9333.5", ""];

describe("loop-workspace config", () => {
  it("throws when MG_CDP_PORT is not set", async () => {
    delete process.env.MG_CDP_PORT;
    await expect(loadWorkspace()).rejects.toThrow(
      "MG_CDP_PORT is not set",
    );
  });

  it.each(badPorts)("throws when MG_CDP_PORT is %j", async (value) => {
    vi.stubEnv("MG_CDP_PORT", value);
    await expect(loadWorkspace()).rejects.toThrow(
      `MG_CDP_PORT must be an integer from 1 to 65535: ${JSON.stringify(value)}`,
    );
  });

  it("connects the browser through the SSH endpoint", async () => {
    const config = await loadWorkspace();
    const workspace = config.workspace as Workspace;
    expect(config.name).toBe("loop-workspace-deepseek-endpoint");
    expect(workspace.name).toBe("build-machine");
    expect(workspace.connectors.map((c) => c.kind)).toEqual([
      "ssh",
      "cdp",
    ]);
    expect(workspace.connectors[1]?.exclusive).toEqual([
      "pi-01.local:9333",
    ]);
  });
});

describe("loop-subagent config", () => {
  it("throws when MG_CLEAN_CDP_PORT is not set", async () => {
    delete process.env.MG_CLEAN_CDP_PORT;
    await expect(loadSubagent()).rejects.toThrow(
      "MG_CLEAN_CDP_PORT is not set",
    );
  });

  it("throws when MG_CLEAN_CDP_PORT is not a port", async () => {
    vi.stubEnv("MG_CLEAN_CDP_PORT", "x");
    await expect(loadSubagent()).rejects.toThrow(
      'MG_CLEAN_CDP_PORT must be an integer from 1 to 65535: "x"',
    );
  });

  it("throws when MG_CDP_PORT is not set", async () => {
    delete process.env.MG_CDP_PORT;
    await expect(loadSubagent()).rejects.toThrow(
      "MG_CDP_PORT is not set",
    );
  });

  it("connects both browsers through their own SSH endpoints", async () => {
    const config = await loadSubagent();
    const clean = config.subagents?.[0]?.workspace;
    if (clean?.pick !== "caller") throw new Error("expected caller");
    const own = clean.sources.find((s) => s.kind === "own");
    if (own?.kind !== "own") throw new Error("expected own source");
    expect(config.name).toBe("loop-subagent-deepseek-endpoint");
    expect(exclusiveNamesOf(config.workspace as Workspace)).toEqual([
      "pi-01.local:9333",
    ]);
    expect(own.workspace.name).toBe("clean-browser");
    expect(exclusiveNamesOf(own.workspace)).toEqual([
      "pi-01.local:9334",
    ]);
  });

  it("declares the same browser name for both workspaces when the ports are equal", async () => {
    vi.stubEnv("MG_CLEAN_CDP_PORT", "9333");
    const config = await loadSubagent();
    const clean = config.subagents?.[0]?.workspace;
    if (clean?.pick !== "caller") throw new Error("expected caller");
    const own = clean.sources.find((s) => s.kind === "own");
    if (own?.kind !== "own") throw new Error("expected own source");
    expect(exclusiveNamesOf(config.workspace as Workspace)).toEqual([
      "pi-01.local:9333",
    ]);
    expect(exclusiveNamesOf(own.workspace)).toEqual([
      "pi-01.local:9333",
    ]);
  });
});
