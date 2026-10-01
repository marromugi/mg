import { posix, win32 } from "node:path";
import { describe, expect, test } from "vitest";
import { isAbsolutePath, toAbsolutePath } from "./index.js";

describe("isAbsolutePath with Windows rules", () => {
  test.each([
    "C:\\x",
    "C:/x",
    "\\\\server\\share\\x",
    "\\\\?\\C:\\x",
    "\\\\.\\pipe\\x",
  ])("accepts %s", (value) => {
    expect(isAbsolutePath(value, win32)).toBe(true);
  });

  test.each(["\\x", "/x", "C:x", "\\\\server", "x\\y", ""])(
    "refuses %s",
    (value) => {
      expect(isAbsolutePath(value, win32)).toBe(false);
    },
  );
});

describe("isAbsolutePath with POSIX rules", () => {
  test.each(["/x", "/"])("accepts %s", (value) => {
    expect(isAbsolutePath(value, posix)).toBe(true);
  });

  test.each(["x", "./x", "../x", "", "C:\\x"])(
    "refuses %s",
    (value) => {
      expect(isAbsolutePath(value, posix)).toBe(false);
    },
  );
});

describe("toAbsolutePath", () => {
  test("gives back an absolute text unchanged", () => {
    expect(toAbsolutePath("/a/b", posix)).toBe("/a/b");
    expect(toAbsolutePath("C:\\a", win32)).toBe("C:\\a");
  });

  test("throws a RangeError naming the text", () => {
    expect(() => toAbsolutePath("src/a.ts", posix)).toThrow(
      new RangeError('not an absolute path: "src/a.ts"'),
    );
    expect(() => toAbsolutePath("C:x", win32)).toThrow(RangeError);
  });
});
