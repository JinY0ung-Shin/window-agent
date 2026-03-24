import { describe, it, expect, beforeEach, vi } from "vitest";
import { useMemoryStore } from "../memoryStore";
import type { MemoryNote } from "../../services/types";

vi.mock("../../services/tauriCommands", () => ({
  listMemoryNotes: vi.fn().mockResolvedValue([]),
  createMemoryNote: vi.fn().mockResolvedValue({
    id: "n2",
    agent_id: "agent-1",
    title: "New",
    content: "new content",
    created_at: "2026-01-02",
    updated_at: "2026-01-02",
  }),
  updateMemoryNote: vi.fn().mockResolvedValue({
    id: "n1",
    agent_id: "agent-1",
    title: "Updated",
    content: "content",
    created_at: "2026-01-01",
    updated_at: "2026-01-03",
  }),
  deleteMemoryNote: vi.fn().mockResolvedValue(undefined),
}));

const mockNote: MemoryNote = {
  id: "n1",
  agent_id: "agent-1",
  title: "Test Note",
  content: "content",
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
};

const initial = useMemoryStore.getState();

beforeEach(() => {
  useMemoryStore.setState(initial, true);
  vi.clearAllMocks();
});

describe("memoryStore", () => {
  it("loadNotes fetches and sets notes", async () => {
    const { listMemoryNotes } = await import("../../services/tauriCommands");
    vi.mocked(listMemoryNotes).mockResolvedValue([mockNote]);
    await useMemoryStore.getState().loadNotes("agent-1");
    expect(useMemoryStore.getState().notes).toEqual([mockNote]);
    expect(useMemoryStore.getState().currentAgentId).toBe("agent-1");
  });

  it("loadNotes sets empty on error", async () => {
    const { listMemoryNotes } = await import("../../services/tauriCommands");
    vi.mocked(listMemoryNotes).mockRejectedValue(new Error("fail"));
    await useMemoryStore.getState().loadNotes("agent-1");
    expect(useMemoryStore.getState().notes).toEqual([]);
    expect(useMemoryStore.getState().currentAgentId).toBe("agent-1");
  });

  it("addNote appends new note", async () => {
    useMemoryStore.setState({ notes: [mockNote] });
    await useMemoryStore.getState().addNote("agent-1", "New", "new content");
    expect(useMemoryStore.getState().notes).toHaveLength(2);
    expect(useMemoryStore.getState().notes[1].id).toBe("n2");
  });

  it("editNote updates matching note", async () => {
    useMemoryStore.setState({ notes: [mockNote] });
    await useMemoryStore.getState().editNote("n1", "Updated");
    expect(useMemoryStore.getState().notes[0].title).toBe("Updated");
  });

  it("removeNote removes matching note", async () => {
    useMemoryStore.setState({ notes: [mockNote] });
    await useMemoryStore.getState().removeNote("n1");
    expect(useMemoryStore.getState().notes).toHaveLength(0);
  });

  it("clear resets state", () => {
    useMemoryStore.setState({ notes: [mockNote], currentAgentId: "agent-1" });
    useMemoryStore.getState().clear();
    expect(useMemoryStore.getState().notes).toEqual([]);
    expect(useMemoryStore.getState().currentAgentId).toBeNull();
  });
});
