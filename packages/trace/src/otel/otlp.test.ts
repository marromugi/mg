import { describe, expect, it } from "vitest";
import { GenAiMappingExporter } from "./genai-exporter.js";
import { createOtlpExporter } from "./otlp.js";

describe("createOtlpExporter", () => {
  it("returns a GenAiMappingExporter wrapping an OTLP exporter, without network I/O", () => {
    const exporter = createOtlpExporter("http://localhost:4318/v1/traces");
    expect(exporter).toBeInstanceOf(GenAiMappingExporter);
  });
});
