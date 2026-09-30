import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, test } from "vitest";
import { InvalidRunConfigError } from "./errors.js";
import { loadRun } from "./load.js";

const execFileAsync = promisify(execFile);

describe("loadRun", () => {
  test("resolves the default export of a valid config", async () => {
    const config = await loadRun("src/__fixtures__/valid.ts");

    expect(config.name).toBe("fixture-valid");
    expect(config.harness).toEqual({
      kind: "loop",
      model: "m",
      maxTurns: 1,
    });
  });

  test("rejects with InvalidRunConfigError when there is no default export", async () => {
    await expect(
      loadRun("src/__fixtures__/no-default-export.ts"),
    ).rejects.toThrow(InvalidRunConfigError);
  });

  test("names the path and the missing field when harness is absent", async () => {
    await expect(
      loadRun("src/__fixtures__/missing-harness.ts"),
    ).rejects.toThrow(
      /src\/__fixtures__\/missing-harness\.ts.*harness/,
    );
  });

  test("rejects with InvalidRunConfigError when gate is not an object with a judge function", async () => {
    await expect(
      loadRun("src/__fixtures__/invalid-gate.ts"),
    ).rejects.toThrow(
      /src\/__fixtures__\/invalid-gate\.ts.*gate must be an object with a judge function/,
    );
  });

  test("resolves the default export of a config with a valid gate", async () => {
    const config = await loadRun("src/__fixtures__/valid-gate.ts");

    expect(config.name).toBe("fixture-valid-gate");
    expect(config.gate).toBeDefined();
  });

  test("rejects with InvalidRunConfigError when provider.name is not a string", async () => {
    await expect(
      loadRun("src/__fixtures__/invalid-provider-name.ts"),
    ).rejects.toThrow(
      /src\/__fixtures__\/invalid-provider-name\.ts.*provider\.name must be a string/,
    );
  });

  test("rejects with the toolForcing message when provider.toolForcing is missing", async () => {
    const error = await loadRun(
      "src/__fixtures__/missing-tool-forcing.ts",
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(InvalidRunConfigError);
    expect((error as InvalidRunConfigError).message).toBe(
      "src/__fixtures__/missing-tool-forcing.ts: provider.toolForcing must be a boolean",
    );
  });

  test("rejects with the toolForcing message when provider.toolForcing is not a boolean", async () => {
    await expect(
      loadRun("src/__fixtures__/invalid-tool-forcing.ts"),
    ).rejects.toThrow(
      "src/__fixtures__/invalid-tool-forcing.ts: provider.toolForcing must be a boolean",
    );
  });

  test("resolves a config whose provider states toolForcing false", async () => {
    const config = await loadRun(
      "src/__fixtures__/valid-no-tool-forcing.ts",
    );

    expect(config.name).toBe("fixture-valid-no-tool-forcing");
  });

  test("rejects with InvalidRunConfigError naming the gate requirement when tools are set without a gate", async () => {
    const error = await loadRun(
      "src/__fixtures__/tools-without-gate.ts",
    ).catch((caught) => caught);

    expect(error).toBeInstanceOf(InvalidRunConfigError);
    expect((error as InvalidRunConfigError).message).toBe(
      "src/__fixtures__/tools-without-gate.ts: gate is required when tools or workspace is set",
    );
  });

  test("rejects with the same gate requirement message for an empty tools array and for a workspace, both without a gate", async () => {
    const emptyToolsError = await loadRun(
      "src/__fixtures__/empty-tools-without-gate.ts",
    ).catch((caught) => caught);
    const workspaceError = await loadRun(
      "src/__fixtures__/workspace-without-gate.ts",
    ).catch((caught) => caught);

    expect(emptyToolsError).toBeInstanceOf(InvalidRunConfigError);
    expect((emptyToolsError as InvalidRunConfigError).message).toBe(
      "src/__fixtures__/empty-tools-without-gate.ts: gate is required when tools or workspace is set",
    );
    expect(workspaceError).toBeInstanceOf(InvalidRunConfigError);
    expect((workspaceError as InvalidRunConfigError).message).toBe(
      "src/__fixtures__/workspace-without-gate.ts: gate is required when tools or workspace is set",
    );
  });

  test("rejects with tools must be an array before checking whether a gate is required", async () => {
    await expect(
      loadRun("src/__fixtures__/tools-not-array.ts"),
    ).rejects.toThrow(/tools must be an array$/);
  });

  test("rejects with the gate-shape message, not the gate requirement, when tools are set and the gate is malformed", async () => {
    await expect(
      loadRun("src/__fixtures__/invalid-gate-with-tools.ts"),
    ).rejects.toThrow(/gate must be an object with a judge function$/);
  });

  test("propagates import failures for a missing file", async () => {
    await expect(
      loadRun("src/__fixtures__/does-not-exist.ts"),
    ).rejects.not.toThrow(InvalidRunConfigError);
  });

  const distLoadPath = fileURLToPath(
    new URL("../dist/load.js", import.meta.url),
  );

  test.skipIf(!existsSync(distLoadPath))(
    "imports a .ts config under the Node runtime, outside of vitest's transform",
    async () => {
      const script = `
        import { loadRun } from ${JSON.stringify(distLoadPath)};
        try {
          await loadRun("./src/__fixtures__/no-default-export.ts");
          console.log("no error thrown");
        } catch (error) {
          console.log(error.name);
        }
      `;
      const { stdout } = await execFileAsync(
        process.execPath,
        ["--input-type=module", "-e", script],
        {
          cwd: fileURLToPath(new URL("..", import.meta.url)),
          timeout: 10_000,
        },
      );

      expect(stdout.trim()).toBe("InvalidRunConfigError");
    },
  );
});
