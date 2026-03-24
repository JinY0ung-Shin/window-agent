import { describe, it, expect, vi, afterEach } from "vitest";
import { getDateGroup, formatShortDate, formatRelativeDate } from "../dateFormat";

// Fix "now" so relative tests are deterministic
const NOW = new Date("2026-03-24T12:00:00Z");

afterEach(() => {
  vi.useRealTimers();
});

function useFakeNow() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
}

describe("getDateGroup", () => {
  it("returns 'today' for today's date", () => {
    useFakeNow();
    const result = getDateGroup("2026-03-24T10:00:00Z", "ko");
    expect(result.key).toBe("today");
  });

  it("returns 'yesterday' for yesterday", () => {
    useFakeNow();
    const result = getDateGroup("2026-03-23T10:00:00Z", "ko");
    expect(result.key).toBe("yesterday");
  });

  it("returns 'this-week' for 3 days ago", () => {
    useFakeNow();
    const result = getDateGroup("2026-03-21T10:00:00Z", "ko");
    expect(result.key).toBe("this-week");
  });

  it("returns ISO date key for older dates", () => {
    useFakeNow();
    // Use a date far enough back that timezone won't cause "this-week"
    const result = getDateGroup("2026-03-01T12:00:00Z", "ko");
    // The key is the local date's ISO string (YYYY-MM-DD)
    const localDate = new Date(2026, 2, 1); // March 1 local
    const expected = localDate.toISOString().slice(0, 10);
    expect(result.key).toBe(expected);
  });

  it("returns 'unknown' for invalid date", () => {
    const result = getDateGroup("not-a-date", "ko");
    expect(result.key).toBe("unknown");
  });
});

describe("formatShortDate", () => {
  it("formats date in Korean locale", () => {
    const date = new Date("2026-03-19T12:00:00Z");
    const result = formatShortDate(date, "ko");
    expect(result).toMatch(/3/);
    expect(result).toMatch(/19/);
  });

  it("formats date in English locale", () => {
    const date = new Date("2026-03-19T12:00:00Z");
    const result = formatShortDate(date, "en");
    expect(result).toMatch(/Mar/);
    expect(result).toMatch(/19/);
  });
});

describe("formatRelativeDate", () => {
  it("returns today label for today", () => {
    useFakeNow();
    const result = formatRelativeDate(new Date("2026-03-24T08:00:00Z"), "ko");
    // Should match the i18n label for today
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns yesterday label for yesterday", () => {
    useFakeNow();
    const result = formatRelativeDate(new Date("2026-03-23T08:00:00Z"), "ko");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns formatted date for older dates", () => {
    useFakeNow();
    const result = formatRelativeDate(new Date("2026-03-10T08:00:00Z"), "ko");
    expect(result).toMatch(/3/);
    expect(result).toMatch(/10/);
  });
});
