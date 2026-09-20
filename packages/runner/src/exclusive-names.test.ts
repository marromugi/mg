import { describe, expect, test } from "vitest";
import { createExclusiveNames } from "./exclusive-names.js";

const flushMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
};

describe("createExclusiveNames", () => {
  test("acquires an empty list immediately, without disturbing an acquire still waiting on a held name", async () => {
    const exclusive = createExclusiveNames();
    const releaseA = await exclusive.acquire(["a"]);

    const release = await exclusive.acquire([]);
    expect(typeof release).toBe("function");
    release();

    let resolved = false;
    const pending = exclusive.acquire(["a"]).then(() => {
      resolved = true;
    });
    await flushMicrotasks();
    expect(resolved).toBe(false);

    releaseA();
    await pending;
    expect(resolved).toBe(true);
  });

  test("waits for a name that is already held before acquiring a list that includes it", async () => {
    const exclusive = createExclusiveNames();
    const releaseA = await exclusive.acquire(["a"]);

    let resolved = false;
    const pending = exclusive.acquire(["a", "b"]).then(() => {
      resolved = true;
    });
    await flushMicrotasks();
    expect(resolved).toBe(false);

    releaseA();
    await pending;
    expect(resolved).toBe(true);
  });

  test("grants acquires that wait on the same name in the order they were started", async () => {
    const exclusive = createExclusiveNames();
    const releaseFirst = await exclusive.acquire(["a"]);

    const order: number[] = [];
    const second = exclusive.acquire(["a"]).then((release) => {
      order.push(2);
      return release;
    });
    const third = exclusive.acquire(["a"]).then((release) => {
      order.push(3);
      return release;
    });
    await flushMicrotasks();
    expect(order).toEqual([]);

    releaseFirst();
    const releaseSecond = await second;
    expect(order).toEqual([2]);

    releaseSecond();
    await third;
    expect(order).toEqual([2, 3]);
  });

  test("acquires a name that shares nothing with a held name, without waiting for it", async () => {
    const exclusive = createExclusiveNames();
    await exclusive.acquire(["a"]);

    const release = await exclusive.acquire(["b"]);
    expect(typeof release).toBe("function");
  });

  test("completes two acquires of the same two names started at once in opposite order, without deadlocking", async () => {
    const exclusive = createExclusiveNames();

    const first = exclusive.acquire(["a", "b"]).then((release) => {
      release();
    });
    const second = exclusive.acquire(["b", "a"]).then((release) => {
      release();
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined,
    ]);
  });

  test("ends a waiting acquire with the signal's abort error without acquiring its name, letting the next waiter proceed once the name frees up", async () => {
    const exclusive = createExclusiveNames();
    const releaseFirst = await exclusive.acquire(["a"]);

    const controller = new AbortController();
    const second = exclusive.acquire(["a"], controller.signal);
    let thirdResolved = false;
    const third = exclusive.acquire(["a"]).then(() => {
      thirdResolved = true;
    });

    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });

    await flushMicrotasks();
    expect(thirdResolved).toBe(false);

    releaseFirst();
    await third;
    expect(thirdResolved).toBe(true);
  });
});
