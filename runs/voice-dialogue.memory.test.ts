import { describe, expect, test } from "vitest";
import {
  createMemoryReport,
  createReflectionQueue,
} from "./voice-dialogue.memory.ts";

describe("createReflectionQueue", () => {
  test("settles idle only after every added reflection has ended", async () => {
    const queue = createReflectionQueue();
    const ended: string[] = [];
    let first: () => void = () => {};
    let second: () => void = () => {};
    queue.add(
      new Promise<void>((resolve) => (first = resolve)).then(() => {
        ended.push("first");
      }),
    );
    queue.add(
      new Promise<void>((resolve) => (second = resolve)).then(() => {
        ended.push("second");
      }),
    );

    const idle = queue.idle().then(() => ended.push("idle"));
    second();
    first();
    await idle;

    expect(ended).toEqual(["second", "first", "idle"]);
  });
});

describe("createMemoryReport", () => {
  test("prints a memory line after the line of the reply it belongs to", () => {
    const lines: string[] = [];
    const report = createMemoryReport((line) => lines.push(line));

    report.memory("memory: one");
    expect(lines).toEqual([]);
    report.replied();
    report.replied();
    report.memory("memory: two");

    expect(lines).toEqual(["memory: one", "memory: two"]);
  });

  test("prints what is still held back when drained", () => {
    const lines: string[] = [];
    const report = createMemoryReport((line) => lines.push(line));

    report.memory("memory: one");
    report.drain();

    expect(lines).toEqual(["memory: one"]);
  });
});
