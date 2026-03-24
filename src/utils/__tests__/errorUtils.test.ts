import { describe, it, expect } from "vitest";
import { toErrorMessage } from "../errorUtils";

describe("toErrorMessage", () => {
  it("extracts message from Error instance", () => {
    expect(toErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("converts string to itself", () => {
    expect(toErrorMessage("plain string")).toBe("plain string");
  });

  it("converts number to string", () => {
    expect(toErrorMessage(42)).toBe("42");
  });

  it("returns 'Unknown error' for plain object", () => {
    expect(toErrorMessage({})).toBe("Unknown error");
  });

  it("converts undefined to string", () => {
    expect(toErrorMessage(undefined)).toBe("undefined");
  });

  it("converts null to string", () => {
    expect(toErrorMessage(null)).toBe("null");
  });
});
