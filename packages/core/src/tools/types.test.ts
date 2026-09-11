import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { describe, expect, expectTypeOf, test } from "vitest";
import type { GenerateRequest, ToolDefinition } from "../providers/types.js";
import { defineTool, type Tool, type ToolContext, type ToolSchema } from "./types.js";

type WeatherInput = { city: string; units?: "c" | "f" };
type WeatherOutput = { city: string; units: "c" | "f" };

const weatherJsonSchema = {
  input: (_options: StandardJSONSchemaV1.Options) => ({
    type: "object",
    properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
    required: ["city"],
  }),
  output: (_options: StandardJSONSchemaV1.Options) => ({
    type: "object",
    properties: { city: { type: "string" }, units: { enum: ["c", "f"] } },
    required: ["city", "units"],
  }),
};

const weatherSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: (value: unknown) => ({ value: { units: "c", ...(value as WeatherInput) } as WeatherOutput }),
    jsonSchema: weatherJsonSchema,
    types: undefined as unknown as { input: WeatherInput; output: WeatherOutput },
  },
} as const satisfies ToolSchema;

const jsonOnlySchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    jsonSchema: weatherJsonSchema,
  },
} as const satisfies StandardJSONSchemaV1;

const weather = defineTool({
  name: "weather",
  description: "Looks up the weather",
  input: weatherSchema,
  execute: async (input, context) => {
    expectTypeOf(input).toEqualTypeOf<WeatherOutput>();
    expectTypeOf(context).toEqualTypeOf<ToolContext>();
    return `${input.city}:${input.units}`;
  },
});

describe("defineTool", () => {
  test("infers the execute input from the schema output type", async () => {
    expectTypeOf(weather).toEqualTypeOf<Tool<typeof weatherSchema>>();
    expectTypeOf(weather.execute).parameter(0).toEqualTypeOf<WeatherOutput>();

    await expect(weather.execute({ city: "Tokyo", units: "f" }, {})).resolves.toBe("Tokyo:f");
  });

  test("returns a tool that fits ToolDefinition and Tool", () => {
    expectTypeOf(weather).toExtend<ToolDefinition>();
    expectTypeOf(weather).toExtend<Tool>();

    const tools: Tool[] = [weather];
    const request: GenerateRequest = { model: "test-model", messages: [], tools };

    expect(request.tools).toEqual([weather]);
  });

  test("rejects a schema without a validate function", () => {
    // @ts-expect-error input must expose ~standard.validate
    defineTool({ name: "weather", input: jsonOnlySchema, execute: async () => "" });

    expect(true).toBe(true);
  });
});
