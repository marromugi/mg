import { describe, expect, it } from "vitest";
import { attrNumber, attrString } from "./attributes.js";

describe("attrString", () => {
  it("returns the value when it is a string", () => {
    expect(attrString({ key: "value" }, "key")).toBe("value");
  });

  it("returns undefined when the key is absent", () => {
    expect(attrString({}, "key")).toBeUndefined();
  });

  it("returns undefined when the value is not a string", () => {
    expect(attrString({ key: 1 }, "key")).toBeUndefined();
  });
});

describe("attrNumber", () => {
  it("returns the value when it is a number", () => {
    expect(attrNumber({ key: 1 }, "key")).toBe(1);
  });

  it("returns undefined when the key is absent", () => {
    expect(attrNumber({}, "key")).toBeUndefined();
  });

  it("returns undefined when the value is not a number", () => {
    expect(attrNumber({ key: "1" }, "key")).toBeUndefined();
  });
});
