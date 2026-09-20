import { defineTool, type Tool, type ToolSchema } from "@mg/core";
import { describe, expect, test } from "vitest";
import {
  ConnectorOpenError,
  DuplicateToolNameError,
  WorkspaceCloseError,
} from "./errors.js";
import { openWorkspace } from "./open.js";
import type { Connector } from "./types.js";

type Validate = ToolSchema["~standard"]["validate"];

const schema: ToolSchema = {
  "~standard": {
    version: 1,
    vendor: "mg-test",
    validate: ((value) => ({ value })) satisfies Validate,
    jsonSchema: {
      input: () => ({ type: "object" }),
      output: () => ({ type: "object" }),
    },
  },
};

const fakeTool = (name: string): Tool =>
  defineTool({
    name,
    input: schema,
    execute: async () => "",
  });

type FakeConnectorOptions = {
  kind: string;
  tools?: readonly Tool[];
  openError?: unknown;
  closeError?: unknown;
  closeOrder?: string[];
};

const createFakeConnector = (
  options: FakeConnectorOptions,
): Connector & { closeCalls: number } => {
  const connector: Connector & { closeCalls: number } = {
    kind: options.kind,
    exclusive: [],
    closeCalls: 0,
    async open() {
      if (options.openError !== undefined) {
        throw options.openError;
      }
      return {
        tools: options.tools ?? [],
        async close() {
          connector.closeCalls += 1;
          options.closeOrder?.push(options.kind);
          if (options.closeError !== undefined) {
            throw options.closeError;
          }
        },
      };
    },
  };
  return connector;
};

describe("openWorkspace", () => {
  test("connects the tools of every connector in order", async () => {
    const toolA1 = fakeTool("a1");
    const toolA2 = fakeTool("a2");
    const toolB1 = fakeTool("b1");
    const a = createFakeConnector({
      kind: "a",
      tools: [toolA1, toolA2],
    });
    const b = createFakeConnector({ kind: "b", tools: [toolB1] });

    const workspace = await openWorkspace({
      name: "ws",
      connectors: [a, b],
    });

    expect(workspace.name).toBe("ws");
    expect(workspace.tools).toEqual([toolA1, toolA2, toolB1]);
  });

  test("closes the already-opened connectors and throws ConnectorOpenError", async () => {
    const cause = new Error("boom");
    const a = createFakeConnector({ kind: "a" });
    const b = createFakeConnector({ kind: "b", openError: cause });

    const error = await openWorkspace({
      name: "ws",
      connectors: [a, b],
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(ConnectorOpenError);
    const openError = error as ConnectorOpenError;
    expect(openError.cause).toBe(cause);
    expect(openError.kind).toBe("b");
    expect(openError.index).toBe(1);
    expect(a.closeCalls).toBe(1);
  });

  test("closes every connector and throws DuplicateToolNameError on a name clash", async () => {
    const a = createFakeConnector({
      kind: "a",
      tools: [fakeTool("x")],
    });
    const b = createFakeConnector({
      kind: "b",
      tools: [fakeTool("x")],
    });

    const error = await openWorkspace({
      name: "ws",
      connectors: [a, b],
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(DuplicateToolNameError);
    const duplicateError = error as DuplicateToolNameError;
    expect(duplicateError.toolName).toBe("x");
    expect(duplicateError.kinds).toEqual(["a", "b"]);
    expect(a.closeCalls).toBe(1);
    expect(b.closeCalls).toBe(1);
  });

  test("close() closes connectors in reverse order and collects failures", async () => {
    const closeOrder: string[] = [];
    const closeCause = new Error("close-b");
    const a = createFakeConnector({ kind: "a", closeOrder });
    const b = createFakeConnector({
      kind: "b",
      closeError: closeCause,
      closeOrder,
    });
    const c = createFakeConnector({ kind: "c", closeOrder });

    const workspace = await openWorkspace({
      name: "ws",
      connectors: [a, b, c],
    });

    const error = await workspace
      .close()
      .catch((thrown: unknown) => thrown);

    expect(closeOrder).toEqual(["c", "b", "a"]);
    expect(error).toBeInstanceOf(WorkspaceCloseError);
    const closeError = error as WorkspaceCloseError;
    expect(closeError.errors).toEqual([closeCause]);
    expect(closeError.cause).toBe(closeCause);
  });

  test("a second close() call does nothing", async () => {
    const a = createFakeConnector({ kind: "a" });

    const workspace = await openWorkspace({
      name: "ws",
      connectors: [a],
    });
    await workspace.close();
    await workspace.close();

    expect(a.closeCalls).toBe(1);
  });

  test("throws without opening anything when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    let opened = false;
    const a = createFakeConnector({ kind: "a" });
    a.open = async () => {
      opened = true;
      return { tools: [], close: async () => {} };
    };

    await expect(
      openWorkspace(
        { name: "ws", connectors: [a] },
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(opened).toBe(false);
  });

  test("closes what was opened when the signal aborts between connectors", async () => {
    const controller = new AbortController();
    const a = createFakeConnector({ kind: "a" });
    a.open = async () => {
      const connection = {
        tools: [],
        close: async () => {
          a.closeCalls += 1;
        },
      };
      controller.abort();
      return connection;
    };
    let bOpened = false;
    const b = createFakeConnector({ kind: "b" });
    b.open = async () => {
      bOpened = true;
      return { tools: [], close: async () => {} };
    };

    const error = await openWorkspace(
      { name: "ws", connectors: [a, b] },
      { signal: controller.signal },
    ).catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ name: "AbortError" });
    expect(a.closeCalls).toBe(1);
    expect(bOpened).toBe(false);
  });

  test("lets an AbortError from a connector through and closes what was opened", async () => {
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    const a = createFakeConnector({ kind: "a" });
    const b = createFakeConnector({ kind: "b", openError: abortError });

    const error = await openWorkspace({
      name: "ws",
      connectors: [a, b],
    }).catch((thrown: unknown) => thrown);

    expect(error).toBe(abortError);
    expect(error).not.toBeInstanceOf(ConnectorOpenError);
    expect(a.closeCalls).toBe(1);
  });
});
