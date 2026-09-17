import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { RunConfig } from "./config.js";
import { InvalidRunConfigError } from "./errors.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const validate = (path: string, value: unknown): RunConfig => {
  if (!isObject(value))
    throw new InvalidRunConfigError(
      path,
      "default export must be an object",
    );

  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new InvalidRunConfigError(
      path,
      "name must be a non-empty string",
    );
  }

  if (!isObject(value.provider)) {
    throw new InvalidRunConfigError(path, "provider must be an object");
  }
  if (typeof value.provider.generate !== "function") {
    throw new InvalidRunConfigError(
      path,
      "provider.generate must be a function",
    );
  }
  if (typeof value.provider.stream !== "function") {
    throw new InvalidRunConfigError(
      path,
      "provider.stream must be a function",
    );
  }
  if (
    value.provider.name !== undefined &&
    typeof value.provider.name !== "string"
  ) {
    throw new InvalidRunConfigError(
      path,
      "provider.name must be a string",
    );
  }

  if (!isObject(value.harness)) {
    throw new InvalidRunConfigError(path, "harness must be an object");
  }
  if (typeof value.harness.kind !== "string") {
    throw new InvalidRunConfigError(
      path,
      "harness.kind must be a string",
    );
  }

  if (value.tools !== undefined && !Array.isArray(value.tools)) {
    throw new InvalidRunConfigError(path, "tools must be an array");
  }

  if (
    value.gate !== undefined &&
    (!isObject(value.gate) || typeof value.gate.judge !== "function")
  ) {
    throw new InvalidRunConfigError(
      path,
      "gate must be an object with a judge function",
    );
  }

  if (value.trace !== undefined && !isObject(value.trace)) {
    throw new InvalidRunConfigError(path, "trace must be an object");
  }

  return value as RunConfig;
};

export const loadRun = async (path: string): Promise<RunConfig> => {
  const resolved = resolve(process.cwd(), path);
  const module = (await import(pathToFileURL(resolved).href)) as {
    default?: unknown;
  };
  return validate(path, module.default);
};
