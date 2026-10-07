import { describe, expect, it } from "vitest";
import { BLINK_SECONDS, blinkOpen, stepSpring } from "./motion.js";

describe("blinkOpen", () => {
  it("rests fully open before and after a blink", () => {
    expect([blinkOpen(0), blinkOpen(BLINK_SECONDS)]).toEqual([1, 1]);
  });

  it("widens before it shuts", () => {
    expect(blinkOpen(0.1)).toBeGreaterThan(1.1);
  });

  it("is shut in the middle", () => {
    expect(blinkOpen(0.2)).toBeLessThan(0.1);
  });

  it("opens past the rest before settling", () => {
    expect(blinkOpen(0.4)).toBeGreaterThan(1.05);
    expect(blinkOpen(0.55)).toBeCloseTo(1, 1);
  });
});

describe("stepSpring", () => {
  const run = (seconds: number) => {
    let spring = { at: 0, speed: 0 };
    let highest = 0;
    for (let time = 0; time < seconds; time += 1 / 120) {
      spring = stepSpring(spring, 1, 1 / 120, 170, 13);
      highest = Math.max(highest, spring.at);
    }
    return { spring, highest };
  };

  it("passes the target and comes back to it", () => {
    const { spring, highest } = run(2);

    expect(highest).toBeGreaterThan(1.02);
    expect(spring.at).toBeCloseTo(1, 2);
  });
});
