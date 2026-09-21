import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, test } from "vitest";
import type { ToolSchema } from "./types.js";
import { validateToolInput } from "./validate.js";

const stubSchema = (
  validate: (
    value: unknown,
  ) =>
    | StandardSchemaV1.Result<unknown>
    | Promise<StandardSchemaV1.Result<unknown>>,
): ToolSchema => ({
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate,
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
});

describe("validateToolInput", () => {
  test("returns the validated value, not the value passed in", async () => {
    const schema = stubSchema(() => ({ value: { prompt: "TRIMMED" } }));

    await expect(
      validateToolInput(schema, { prompt: "  raw  " }),
    ).resolves.toEqual({ ok: true, value: { prompt: "TRIMMED" } });
  });

  test("returns the issues when validation fails", async () => {
    const schema = stubSchema(() => ({
      issues: [{ message: "Expected string" }],
    }));

    await expect(
      validateToolInput(schema, { prompt: 1 }),
    ).resolves.toEqual({
      ok: false,
      issues: [{ message: "Expected string" }],
    });
  });

  test("lets an error thrown by the schema's validate through unchanged", async () => {
    const thrown = new Error("schema broke");
    const schema = stubSchema(() => {
      throw thrown;
    });

    await expect(validateToolInput(schema, {})).rejects.toBe(thrown);
  });
});
