import { describe, it, expect, beforeEach } from "vitest";
import { onLifecycleEvent, emitLifecycleEvent } from "../lifecycleEvents";
import type { LifecycleEvent } from "../lifecycleEvents";

// Suppress console.warn from logger used inside lifecycleEvents
vi.mock("../logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("lifecycleEvents", () => {
  let unsubs: (() => void)[];

  beforeEach(() => {
    unsubs = [];
  });

  afterEach(() => {
    // Clean up all subscriptions
    for (const unsub of unsubs) unsub();
  });

  function subscribe(listener: (event: LifecycleEvent) => void | Promise<void>) {
    const unsub = onLifecycleEvent(listener);
    unsubs.push(unsub);
    return unsub;
  }

  it("listener receives emitted events", () => {
    const received: LifecycleEvent[] = [];
    subscribe((e) => { received.push(e); });

    emitLifecycleEvent({ type: "app:init" });
    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("app:init");
  });

  it("multiple listeners all receive the same event", () => {
    const calls1: string[] = [];
    const calls2: string[] = [];
    subscribe((e) => { calls1.push(e.type); });
    subscribe((e) => { calls2.push(e.type); });

    emitLifecycleEvent({ type: "app:ready" });
    expect(calls1).toEqual(["app:ready"]);
    expect(calls2).toEqual(["app:ready"]);
  });

  it("unsubscribe prevents further events", () => {
    const received: string[] = [];
    const unsub = subscribe((e) => { received.push(e.type); });

    emitLifecycleEvent({ type: "app:init" });
    expect(received).toHaveLength(1);

    unsub();
    emitLifecycleEvent({ type: "app:ready" });
    expect(received).toHaveLength(1); // no new event
  });

  it("sync listener errors do not prevent other listeners from running", () => {
    const received: string[] = [];
    subscribe(() => { throw new Error("boom"); });
    subscribe((e) => { received.push(e.type); });

    emitLifecycleEvent({ type: "app:init" });
    expect(received).toEqual(["app:init"]);
  });

  it("event payload is correctly passed (agent:boot with agentId)", () => {
    let captured: LifecycleEvent | null = null;
    subscribe((e) => { captured = e; });

    emitLifecycleEvent({ type: "agent:boot", agentId: "a1", folderName: "folder-a1" });
    expect(captured).toEqual({ type: "agent:boot", agentId: "a1", folderName: "folder-a1" });
  });
});
