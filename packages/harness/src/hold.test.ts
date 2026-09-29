import { describe, expect, test } from "vitest";
import { createHoldController } from "./hold.js";

const timer = (ms: number): Promise<"timer"> =>
  new Promise((resolve) => setTimeout(() => resolve("timer"), ms));

describe("createHoldController", () => {
  test("a new controller is not held and released() resolves at once", async () => {
    const { signal } = createHoldController();
    expect(signal.held).toBe(false);
    const winner = await Promise.race([
      signal.released().then(() => "released"),
      timer(0),
    ]);
    expect(winner).toBe("released");
  });

  test("released() stays pending while held and resolves on release", async () => {
    const controller = createHoldController();
    controller.hold();
    expect(controller.signal.held).toBe(true);
    const wait = controller.signal.released().then(() => "released");
    expect(await Promise.race([wait, timer(20)])).toBe("timer");
    controller.release();
    expect(await wait).toBe("released");
    expect(controller.signal.held).toBe(false);
  });

  test("release settles every pending wait, holding again pends new ones, and releasing twice is harmless", async () => {
    const controller = createHoldController();
    controller.hold();
    const waits = [1, 2, 3].map(() => controller.signal.released());
    controller.release();
    await Promise.all(waits);

    controller.hold();
    expect(controller.signal.held).toBe(true);
    const again = controller.signal.released().then(() => "released");
    expect(await Promise.race([again, timer(20)])).toBe("timer");

    controller.release();
    expect(() => controller.release()).not.toThrow();
    expect(controller.signal.held).toBe(false);
  });
});
