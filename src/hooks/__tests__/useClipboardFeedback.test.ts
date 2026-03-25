import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useClipboardFeedback } from "../useClipboardFeedback";

describe("useClipboardFeedback", () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: writeTextMock },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with copied = false", () => {
    const { result } = renderHook(() => useClipboardFeedback());
    expect(result.current.copied).toBe(false);
  });

  it("sets copied to true after copy, then resets after duration", async () => {
    const { result } = renderHook(() => useClipboardFeedback(1000));

    await act(async () => {
      await result.current.copy("hello");
    });

    expect(writeTextMock).toHaveBeenCalledWith("hello");
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(result.current.copied).toBe(false);
  });

  it("uses default duration of 2000ms", async () => {
    const { result } = renderHook(() => useClipboardFeedback());

    await act(async () => {
      await result.current.copy("text");
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it("respects custom duration", async () => {
    const { result } = renderHook(() => useClipboardFeedback(500));

    await act(async () => {
      await result.current.copy("short");
    });

    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(result.current.copied).toBe(false);
  });
});
