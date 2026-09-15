import { expect, test } from "vitest";
import { createTerm, term } from "./term.js";

test("paints when isTTY is true and no env overrides", () => {
  const t = createTerm({ isTTY: true, env: {} });
  expect(t.paint("success", "ok")).toBe("\x1b[32mok\x1b[0m");
});

test("leaves text unchanged when isTTY is false", () => {
  const t = createTerm({ isTTY: false, env: {} });
  expect(t.paint("success", "ok")).toBe("ok");
});

test("leaves text unchanged when NO_COLOR is set, even on a TTY", () => {
  const t = createTerm({ isTTY: true, env: { NO_COLOR: "1" } });
  expect(t.paint("success", "ok")).toBe("ok");
});

test("paints when FORCE_COLOR is set, even off a TTY", () => {
  const t = createTerm({ isTTY: false, env: { FORCE_COLOR: "1" } });
  expect(t.paint("success", "ok")).toBe("\x1b[32mok\x1b[0m");
});

test("does not treat FORCE_COLOR=0 as forcing color", () => {
  const t = createTerm({ isTTY: false, env: { FORCE_COLOR: "0" } });
  expect(t.paint("success", "ok")).toBe("ok");
});

test("mark.error is fixed regardless of color state", () => {
  const withColor = createTerm({ isTTY: true, env: {} });
  const withoutColor = createTerm({ isTTY: false, env: {} });
  expect(withColor.mark.error).toBe("❌");
  expect(withoutColor.mark.error).toBe("❌");
});

test("the default term export exists", () => {
  expect(typeof term.colorEnabled).toBe("boolean");
});
