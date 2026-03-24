import { describe, it, expect, vi, beforeEach } from "vitest";
import { useStreamStore } from "../streamStore";
import type { ActiveRun } from "../../services/types";

vi.mock("../../services/tauriCommands", () => ({
  abortStream: vi.fn().mockResolvedValue(undefined),
}));

const makeRun = (overrides: Partial<ActiveRun> = {}): ActiveRun => ({
  requestId: "req-1",
  conversationId: "conv-1",
  targetMessageId: "msg-1",
  status: "streaming",
  ...overrides,
});

const initial = useStreamStore.getState();

beforeEach(() => {
  useStreamStore.setState(initial, true);
});

describe("streamStore", () => {
  it("startRun sets activeRun", () => {
    const run = makeRun();
    useStreamStore.getState().startRun(run);
    expect(useStreamStore.getState().activeRun).toEqual(run);
  });

  it("endRun clears activeRun", () => {
    useStreamStore.getState().startRun(makeRun());
    useStreamStore.getState().endRun();
    expect(useStreamStore.getState().activeRun).toBeNull();
  });

  it("abortStream calls abortStream command", async () => {
    const { abortStream } = await import("../../services/tauriCommands");
    useStreamStore.getState().startRun(makeRun({ requestId: "req-42" }));
    await useStreamStore.getState().abortStream();
    expect(abortStream).toHaveBeenCalledWith("req-42");
  });

  it("abortStream does nothing when no active run", async () => {
    const { abortStream } = await import("../../services/tauriCommands");
    vi.mocked(abortStream).mockClear();
    await useStreamStore.getState().abortStream();
    expect(abortStream).not.toHaveBeenCalled();
  });

  it("addRun adds to runsById", () => {
    const run = makeRun({ requestId: "team-1" });
    useStreamStore.getState().addRun("team-1", run);
    expect(useStreamStore.getState().runsById["team-1"]).toEqual(run);
  });

  it("removeRun removes from runsById", () => {
    const run = makeRun({ requestId: "team-1" });
    useStreamStore.getState().addRun("team-1", run);
    useStreamStore.getState().removeRun("team-1");
    expect(useStreamStore.getState().runsById["team-1"]).toBeUndefined();
  });

  it("getActiveRuns returns DM + team runs", () => {
    const dm = makeRun({ requestId: "dm" });
    const team = makeRun({ requestId: "team-1" });
    useStreamStore.getState().startRun(dm);
    useStreamStore.getState().addRun("team-1", team);
    const runs = useStreamStore.getState().getActiveRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].requestId).toBe("dm");
    expect(runs[1].requestId).toBe("team-1");
  });

  it("getActiveRuns returns only team runs when no DM", () => {
    useStreamStore.getState().addRun("t1", makeRun({ requestId: "t1" }));
    expect(useStreamStore.getState().getActiveRuns()).toHaveLength(1);
  });
});
