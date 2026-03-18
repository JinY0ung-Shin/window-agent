import { create } from "zustand";
import type {
  VaultNote,
  VaultNoteSummary,
  GraphData,
  SearchResult,
  ConflictInfo,
  NoteType,
  CreateNoteParams,
  NoteUpdates,
} from "../services/vaultTypes";
import * as vault from "../services/commands/vaultCommands";

type NotesStatus = "idle" | "loading" | "loaded" | "error";

interface VaultState {
  // 상태
  notes: VaultNoteSummary[];
  notesStatus: NotesStatus;
  graph: GraphData | null;
  selectedNote: VaultNote | null;
  searchResults: SearchResult[];
  conflicts: ConflictInfo[];

  // 필터
  activeAgent: string | null;
  activeCategory: NoteType | null;
  activeTags: string[];

  // 액션
  loadNotes: (agentId?: string) => Promise<void>;
  loadGraph: (agentId?: string, depth?: number) => Promise<void>;
  createNote: (params: CreateNoteParams) => Promise<VaultNote>;
  updateNote: (noteId: string, updates: NoteUpdates) => Promise<VaultNote>;
  deleteNote: (noteId: string) => Promise<void>;
  search: (query: string, scope?: "self" | "shared" | "all") => Promise<void>;
  selectNote: (noteId: string) => Promise<void>;
  clearSelection: () => void;
  openInObsidian: () => Promise<void>;
  resolveConflict: (noteId: string, choice: "local" | "disk") => Promise<void>;

  // 필터 액션
  setActiveAgent: (agentId: string | null) => void;
  setActiveCategory: (category: NoteType | null) => void;
  setActiveTags: (tags: string[]) => void;

  // 프롬프트 호환
  getPromptReadyNotes: (agentId: string) => VaultNoteSummary[];

  // 초기화
  clear: () => void;
}

let _loadVersion = 0;

export const useVaultStore = create<VaultState>((set, get) => ({
  notes: [],
  notesStatus: "idle",
  graph: null,
  selectedNote: null,
  searchResults: [],
  conflicts: [],

  activeAgent: null,
  activeCategory: null,
  activeTags: [],

  loadNotes: async (agentId) => {
    const version = ++_loadVersion;
    set({ notes: [], notesStatus: "loading", activeAgent: agentId ?? null });
    try {
      const notes = await vault.vaultListNotes(agentId);
      if (version === _loadVersion) {
        set({ notes, notesStatus: "loaded" });
      }
    } catch {
      if (version === _loadVersion) {
        set({ notes: [], notesStatus: "error" });
      }
    }
  },

  loadGraph: async (agentId, depth) => {
    try {
      const graph = await vault.vaultGetGraph(agentId, depth);
      set({ graph });
    } catch {
      set({ graph: null });
    }
  },

  createNote: async (params) => {
    const note = await vault.vaultCreateNote(params);
    // Reload notes to get updated summary list
    const notes = await vault.vaultListNotes(get().activeAgent);
    set({ notes, notesStatus: "loaded" });
    return note;
  },

  updateNote: async (noteId, updates) => {
    const agentId = get().activeAgent ?? "user";
    const note = await vault.vaultUpdateNote(noteId, agentId, updates);
    const notes = await vault.vaultListNotes(get().activeAgent);
    set({ notes, notesStatus: "loaded", selectedNote: note });
    return note;
  },

  deleteNote: async (noteId) => {
    await vault.vaultDeleteNote(noteId, "user");  // UI에서 삭제는 항상 "user"
    const { selectedNote } = get();
    set({
      notes: get().notes.filter((n) => n.id !== noteId),
      notesStatus: "loaded",
      selectedNote: selectedNote?.id === noteId ? null : selectedNote,
    });
  },

  search: async (query, scope) => {
    try {
      const agentId = scope === "self" ? get().activeAgent : null;
      const searchResults = await vault.vaultSearch(query, scope, agentId);
      set({ searchResults });
    } catch {
      set({ searchResults: [] });
    }
  },

  selectNote: async (noteId) => {
    try {
      const note = await vault.vaultReadNote(noteId);
      set({ selectedNote: note });
    } catch {
      set({ selectedNote: null });
    }
  },

  clearSelection: () => set({ selectedNote: null }),

  openInObsidian: async () => {
    await vault.vaultOpenInObsidian();
  },

  resolveConflict: async (noteId, choice) => {
    // After resolving, remove the conflict from the list and reload
    if (choice === "disk") {
      // Re-read from disk (rebuild index picks up disk version)
      await vault.vaultRebuildIndex();
    }
    // Remove conflict entry
    set({ conflicts: get().conflicts.filter((c) => c.noteId !== noteId) });
    // Reload affected note if selected
    if (get().selectedNote?.id === noteId) {
      try {
        const note = await vault.vaultReadNote(noteId);
        set({ selectedNote: note });
      } catch {
        set({ selectedNote: null });
      }
    }
  },

  setActiveAgent: (agentId) => set({ activeAgent: agentId }),
  setActiveCategory: (category) => set({ activeCategory: category }),
  setActiveTags: (tags) => set({ activeTags: tags }),

  getPromptReadyNotes: (agentId) => {
    const { notes } = get();
    return notes.filter((n) => n.agent === agentId);
  },

  clear: () => {
    ++_loadVersion;
    set({
      notes: [],
      notesStatus: "idle",
      graph: null,
      selectedNote: null,
      searchResults: [],
      conflicts: [],
      activeAgent: null,
      activeCategory: null,
      activeTags: [],
    });
  },
}));
