import { describe, it, expect } from "vitest";
import { estimateTokens, estimateMessageTokens } from "../tokenEstimator";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates ASCII-only text", () => {
    // "hello" = 5 chars * 0.25 = 1.25 → ceil = 2
    expect(estimateTokens("hello")).toBe(2);
  });

  it("estimates Korean-only text", () => {
    // "안녕하세요" = 5 chars * 1.5 = 7.5 → ceil = 8
    expect(estimateTokens("안녕하세요")).toBe(8);
  });

  it("estimates mixed Korean and ASCII text", () => {
    // "안녕 hello" = 2 Korean(3.0) + 1 space(0.25) + 5 ASCII(1.25) = 4.5 → ceil = 5
    expect(estimateTokens("안녕 hello")).toBe(5);
  });

  it("estimates other multibyte characters", () => {
    // "日本語" = 3 chars * 1.2 = 3.6 → ceil = 4
    expect(estimateTokens("日本語")).toBe(4);
  });
});

describe("estimateMessageTokens", () => {
  it("adds 4 tokens overhead to content estimate", () => {
    const msg = { role: "user", content: "hello" };
    // estimateTokens("hello") = 2, + 4 overhead = 6
    expect(estimateMessageTokens(msg)).toBe(6);
  });

  it("adds 4 tokens overhead for empty content", () => {
    const msg = { role: "user", content: "" };
    // estimateTokens("") = 0, + 4 overhead = 4
    expect(estimateMessageTokens(msg)).toBe(4);
  });
});
