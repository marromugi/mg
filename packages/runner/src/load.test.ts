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
