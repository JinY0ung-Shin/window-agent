import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useLoadOnOpen } from "../useLoadOnOpen";

describe("useLoadOnOpen", () => {
  it("loads data when enabled (default)", async () => {
    const loader = vi.fn().mockResolvedValue("hello");
    const { result } = renderHook(() => useLoadOnOpen(loader));

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBe("hello");
    expect(result.current.error).toBe("");
    expect(loader).toHaveBeenCalledOnce();
  });

  it("does not load when enabled is false", async () => {
    const loader = vi.fn().mockResolvedValue("hello");
    const { result } = renderHook(() => useLoadOnOpen(loader, false));

    // Give time for any potential call
    await new Promise((r) => setTimeout(r, 50));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it("sets error on loader failure", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("fail"));
    const { result } = renderHook(() => useLoadOnOpen(loader));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("fail");
  });

  it("reload re-fetches data", async () => {
    let callCount = 0;
    const loader = vi.fn().mockImplementation(async () => {
      callCount++;
      return `data-${callCount}`;
    });
    const { result } = renderHook(() => useLoadOnOpen(loader));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("data-1");

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toBe("data-2");
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it("loads when enabled switches from false to true", async () => {
    const loader = vi.fn().mockResolvedValue("loaded");
    const { result, rerender } = renderHook(
      ({ enabled }) => useLoadOnOpen(loader, enabled),
      { initialProps: { enabled: false } },
    );

    expect(loader).not.toHaveBeenCalled();

    rerender({ enabled: true });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toBe("loaded");
    expect(loader).toHaveBeenCalledOnce();
  });
});
