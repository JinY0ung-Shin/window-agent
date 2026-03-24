import { describe, it, expect, beforeEach, vi } from "vitest";
import { useVaultStore } from "../vaultStore";
import type {
  VaultNote,
  VaultNoteSummary,
  GraphData,
  SearchResult,
} from "../../services/vaultTypes";

vi.mock("../../services/commands/vaultCommands", () => ({
  vaultListNotes: vi.fn().mockResolvedValue([]),
  vaultGetGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
  vaultCreateNote: vi.fn().mockResolvedValue({ id: "note-new" }),
  vaultUpdateNote: vi.fn().mockResolvedValue({ id: "note-1" }),
  vaultDeleteNote: vi.fn().mockResolvedValue(undefined),
  vaultSearch: vi.fn().mockResolvedValue([]),
  vaultReadNote: vi.fn().mockResolvedValue({ id: "note-1" }),
  vaultOpenInObsidian: vi.fn().mockResolvedValue(undefined),
  vaultRebuildIndex: vi.fn().mockResolvedValue({ totalNotes: 0, totalLinks: 0 }),
}));

vi.mock("../../services/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn() },
}));

const mockNote: VaultNote = {
  id: "note-1",
  agent: "agent-1",
  noteType: "knowledge",
  scope: "agent",
  title: "Test Note",
  content: "test content",
  tags: ["tag1"],
  confidence: 0.9,
  created: "2026-01-01",
  updated: "2026-01-01",
  revision: "rev-1",
  source: null,
  aliases: [],
  legacyId: null,
  lastEditedBy: null,
  path: "/vault/note-1.md",
};

const mockSummary: VaultNoteSummary = {
  id: "note-1",
  agent: "agent-1",
  noteType: "knowledge",
  title: "Test Note",
  bodyPreview: "test content",
  tags: ["tag1"],
  confidence: 0.9,
  scope: "agent",
  sourceConversation: null,
  created: "2026-01-01",
  updated: "2026-01-01",
};

const mockGraph: GraphData = {
  nodes: [{ id: "note-1", label: "Test Note", agent: "agent-1", noteType: "knowledge", tags: ["tag1"], confidence: 0.9, updatedAt: "2026-01-01" }],
  edges: [],
};

const mockSearchResult: SearchResult = {
  noteId: "note-1",
  title: "Test Note",
  snippet: "test content",
  score: 0.95,
};

const initial = useVaultStore.getState();

beforeEach(() => {
  useVaultStore.setState(initial, true);
  vi.clearAllMocks();
});

describe("vaultStore", () => {
  // ── loadNotes ──

  it("loadNotes fetches and sets notes", async () => {
    const { vaultListNotes } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultListNotes).mockResolvedValue([mockSummary]);

    await useVaultStore.getState().loadNotes("agent-1");

    expect(vaultListNotes).toHaveBeenCalledWith("agent-1");
    expect(useVaultStore.getState().notes).toEqual([mockSummary]);
    expect(useVaultStore.getState().notesStatus).toBe("loaded");
    expect(useVaultStore.getState().activeAgent).toBe("agent-1");
  });

  it("loadNotes sets error status on failure", async () => {
    const { vaultListNotes } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultListNotes).mockRejectedValue(new Error("fail"));

    await useVaultStore.getState().loadNotes("agent-1");

    expect(useVaultStore.getState().notes).toEqual([]);
    expect(useVaultStore.getState().notesStatus).toBe("error");
  });

  it("loadNotes without agentId sets activeAgent to null", async () => {
    const { vaultListNotes } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultListNotes).mockResolvedValue([]);

    await useVaultStore.getState().loadNotes();

    expect(useVaultStore.getState().activeAgent).toBeNull();
  });

  // ── loadGraph ──

  it("loadGraph fetches and sets graph", async () => {
    const { vaultGetGraph } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultGetGraph).mockResolvedValue(mockGraph);

    await useVaultStore.getState().loadGraph("agent-1", 3);

    expect(vaultGetGraph).toHaveBeenCalledWith("agent-1", 3);
    expect(useVaultStore.getState().graph).toEqual(mockGraph);
  });

  it("loadGraph sets null on error", async () => {
    const { vaultGetGraph } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultGetGraph).mockRejectedValue(new Error("fail"));

    await useVaultStore.getState().loadGraph();

    expect(useVaultStore.getState().graph).toBeNull();
  });

  // ── createNote ──

  it("createNote calls command and reloads notes", async () => {
    const { vaultCreateNote, vaultListNotes } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultCreateNote).mockResolvedValue(mockNote);
    vi.mocked(vaultListNotes).mockResolvedValue([mockSummary]);

    const params = {
      agentId: "agent-1",
      category: "knowledge" as const,
      title: "Test Note",
      content: "test content",
    };

    const result = await useVaultStore.getState().createNote(params);

    expect(vaultCreateNote).toHaveBeenCalledWith(params);
    expect(result).toEqual(mockNote);
    expect(useVaultStore.getState().notes).toEqual([mockSummary]);
    expect(useVaultStore.getState().notesStatus).toBe("loaded");
  });

  // ── updateNote ──

  it("updateNote calls command and updates state", async () => {
    const { vaultUpdateNote, vaultListNotes } = await import("../../services/commands/vaultCommands");
    const updatedNote = { ...mockNote, title: "Updated" };
    vi.mocked(vaultUpdateNote).mockResolvedValue(updatedNote);
    vi.mocked(vaultListNotes).mockResolvedValue([{ ...mockSummary, title: "Updated" }]);

    useVaultStore.setState({ activeAgent: "agent-1" });

    const result = await useVaultStore.getState().updateNote("note-1", { title: "Updated" });

    expect(vaultUpdateNote).toHaveBeenCalledWith("note-1", "agent-1", { title: "Updated" });
    expect(result).toEqual(updatedNote);
    expect(useVaultStore.getState().selectedNote).toEqual(updatedNote);
  });

  it("updateNote uses 'user' when activeAgent is null", async () => {
    const { vaultUpdateNote, vaultListNotes } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultUpdateNote).mockResolvedValue(mockNote);
    vi.mocked(vaultListNotes).mockResolvedValue([mockSummary]);

    useVaultStore.setState({ activeAgent: null });

    await useVaultStore.getState().updateNote("note-1", { title: "Updated" });

    expect(vaultUpdateNote).toHaveBeenCalledWith("note-1", "user", { title: "Updated" });
  });

  // ── deleteNote ──

  it("deleteNote removes note from list", async () => {
    const { vaultDeleteNote } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultDeleteNote).mockResolvedValue(undefined);

    useVaultStore.setState({ notes: [mockSummary], selectedNote: null });

    await useVaultStore.getState().deleteNote("note-1");

    expect(vaultDeleteNote).toHaveBeenCalledWith("note-1", "user");
    expect(useVaultStore.getState().notes).toEqual([]);
  });

  it("deleteNote clears selectedNote when deleting selected", async () => {
    const { vaultDeleteNote } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultDeleteNote).mockResolvedValue(undefined);

    useVaultStore.setState({ notes: [mockSummary], selectedNote: mockNote });

    await useVaultStore.getState().deleteNote("note-1");

    expect(useVaultStore.getState().selectedNote).toBeNull();
  });

  it("deleteNote keeps selectedNote when deleting different note", async () => {
    const { vaultDeleteNote } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultDeleteNote).mockResolvedValue(undefined);

    const otherSummary = { ...mockSummary, id: "note-2" };
    useVaultStore.setState({ notes: [mockSummary, otherSummary], selectedNote: mockNote });

    await useVaultStore.getState().deleteNote("note-2");

    expect(useVaultStore.getState().selectedNote).toEqual(mockNote);
    expect(useVaultStore.getState().notes).toEqual([mockSummary]);
  });

  // ── search ──

  it("search fetches and sets results", async () => {
    const { vaultSearch } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultSearch).mockResolvedValue([mockSearchResult]);

    await useVaultStore.getState().search("test query", "all");

    expect(vaultSearch).toHaveBeenCalledWith("test query", "all", null);
    expect(useVaultStore.getState().searchResults).toEqual([mockSearchResult]);
  });

  it("search with scope=self passes activeAgent", async () => {
    const { vaultSearch } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultSearch).mockResolvedValue([]);

    useVaultStore.setState({ activeAgent: "agent-1" });

    await useVaultStore.getState().search("query", "self");

    expect(vaultSearch).toHaveBeenCalledWith("query", "self", "agent-1");
  });

  it("search sets empty results on error", async () => {
    const { vaultSearch } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultSearch).mockRejectedValue(new Error("fail"));

    await useVaultStore.getState().search("query");

    expect(useVaultStore.getState().searchResults).toEqual([]);
  });

  // ── selectNote ──

  it("selectNote fetches and sets selectedNote", async () => {
    const { vaultReadNote } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultReadNote).mockResolvedValue(mockNote);

    await useVaultStore.getState().selectNote("note-1");

    expect(vaultReadNote).toHaveBeenCalledWith("note-1");
    expect(useVaultStore.getState().selectedNote).toEqual(mockNote);
  });

  it("selectNote sets null on error", async () => {
    const { vaultReadNote } = await import("../../services/commands/vaultCommands");
    vi.mocked(vaultReadNote).mockRejectedValue(new Error("fail"));

    await useVaultStore.getState().selectNote("note-1");

    expect(useVaultStore.getState().selectedNote).toBeNull();
  });

  // ── clearSelection ──

  it("clearSelection sets selectedNote to null", () => {
    useVaultStore.setState({ selectedNote: mockNote });

    useVaultStore.getState().clearSelection();

    expect(useVaultStore.getState().selectedNote).toBeNull();
  });

  // ── filter actions ──

  it("setActiveAgent updates activeAgent", () => {
    useVaultStore.getState().setActiveAgent("agent-1");
    expect(useVaultStore.getState().activeAgent).toBe("agent-1");
  });

  it("setActiveAgent sets null", () => {
    useVaultStore.setState({ activeAgent: "agent-1" });
    useVaultStore.getState().setActiveAgent(null);
    expect(useVaultStore.getState().activeAgent).toBeNull();
  });

  it("setActiveCategory updates activeCategory", () => {
    useVaultStore.getState().setActiveCategory("knowledge");
    expect(useVaultStore.getState().activeCategory).toBe("knowledge");
  });

  it("setActiveCategory sets null", () => {
    useVaultStore.setState({ activeCategory: "knowledge" });
    useVaultStore.getState().setActiveCategory(null);
    expect(useVaultStore.getState().activeCategory).toBeNull();
  });

  it("setActiveTags updates activeTags", () => {
    useVaultStore.getState().setActiveTags(["tag1", "tag2"]);
    expect(useVaultStore.getState().activeTags).toEqual(["tag1", "tag2"]);
  });

  // ── getPromptReadyNotes ──

  it("getPromptReadyNotes filters by agentId", () => {
    const otherSummary: VaultNoteSummary = { ...mockSummary, id: "note-2", agent: "agent-2" };
    useVaultStore.setState({ notes: [mockSummary, otherSummary] });

    const result = useVaultStore.getState().getPromptReadyNotes("agent-1");

    expect(result).toEqual([mockSummary]);
  });

  it("getPromptReadyNotes returns empty when no match", () => {
    useVaultStore.setState({ notes: [mockSummary] });

    const result = useVaultStore.getState().getPromptReadyNotes("agent-999");

    expect(result).toEqual([]);
  });

  // ── clear ──

  it("clear resets all state", () => {
    useVaultStore.setState({
      notes: [mockSummary],
      notesStatus: "loaded",
      graph: mockGraph,
      selectedNote: mockNote,
      searchResults: [mockSearchResult],
      conflicts: [],
      activeAgent: "agent-1",
      activeCategory: "knowledge",
      activeTags: ["tag1"],
    });

    useVaultStore.getState().clear();

    const s = useVaultStore.getState();
    expect(s.notes).toEqual([]);
    expect(s.notesStatus).toBe("idle");
    expect(s.graph).toBeNull();
    expect(s.selectedNote).toBeNull();
    expect(s.searchResults).toEqual([]);
    expect(s.conflicts).toEqual([]);
    expect(s.activeAgent).toBeNull();
    expect(s.activeCategory).toBeNull();
    expect(s.activeTags).toEqual([]);
  });

  // ── initial state ──

  it("has correct initial state", () => {
    const s = useVaultStore.getState();
    expect(s.notes).toEqual([]);
    expect(s.notesStatus).toBe("idle");
    expect(s.graph).toBeNull();
    expect(s.selectedNote).toBeNull();
    expect(s.searchResults).toEqual([]);
    expect(s.conflicts).toEqual([]);
    expect(s.activeAgent).toBeNull();
    expect(s.activeCategory).toBeNull();
    expect(s.activeTags).toEqual([]);
  });
});
