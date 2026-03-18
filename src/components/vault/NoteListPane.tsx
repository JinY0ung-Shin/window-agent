import { useState, useCallback, useMemo, useRef } from "react";
import { useVaultStore } from "../../stores/vaultStore";
import type { NoteType } from "../../services/vaultTypes";
import NoteSearchBar from "./NoteSearchBar";
import NoteFilterBar from "./NoteFilterBar";
import NoteListItem from "./NoteListItem";

export default function NoteListPane() {
  const {
    notes,
    notesStatus,
    searchResults,
    selectedNote,
    activeCategory,
    activeTags,
    search,
    selectNote,
    setActiveCategory,
    setActiveTags,
  } = useVaultStore();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchScope, setSearchScope] = useState<"all" | "self" | "shared">("all");
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  // Note: loadNotes is owned by VaultPanel (agent-scoped). This pane only displays.

  // Debounced search
  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchQuery(value);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (!value.trim()) return;
      debounceRef.current = setTimeout(() => {
        search(value.trim(), searchScope === "all" ? undefined : searchScope);
      }, 300);
    },
    [search, searchScope],
  );

  const handleScopeChange = useCallback(
    (scope: "all" | "self" | "shared") => {
      setSearchScope(scope);
      if (searchQuery.trim()) {
        search(searchQuery.trim(), scope === "all" ? undefined : scope);
      }
    },
    [search, searchQuery],
  );

  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  // Derive available tags from notes
  const availableTags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const n of notes) {
      for (const t of n.tags) tagSet.add(t);
    }
    return Array.from(tagSet).sort();
  }, [notes]);

  // Filter notes by category and tags
  const filteredNotes = useMemo(() => {
    return notes.filter((n) => {
      if (activeCategory && n.noteType !== activeCategory) return false;
      if (activeTags.length > 0 && !activeTags.some((t) => n.tags.includes(t)))
        return false;
      return true;
    });
  }, [notes, activeCategory, activeTags]);

  // When searching, map searchResults to note summaries
  const displayNotes = useMemo(() => {
    if (!searchQuery.trim()) return filteredNotes;
    const idSet = new Set(searchResults.map((r) => r.noteId));
    return filteredNotes.filter((n) => idSet.has(n.id));
  }, [searchQuery, searchResults, filteredNotes]);

  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="vault-note-list-pane">
      <NoteSearchBar
        value={searchQuery}
        scope={searchScope}
        onValueChange={handleSearchChange}
        onScopeChange={handleScopeChange}
        onClear={handleClearSearch}
      />
      <NoteFilterBar
        activeCategory={activeCategory}
        activeTags={activeTags}
        availableTags={availableTags}
        onCategoryChange={(cat) => setActiveCategory(cat as NoteType | null)}
        onTagsChange={setActiveTags}
      />
      <div className="vault-note-list">
        {notesStatus === "idle" || notesStatus === "loading" ? (
          <div className="vault-note-list-skeleton">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="vault-note-skeleton-item">
                <div className="skeleton-line skeleton-title" />
                <div className="skeleton-line skeleton-preview" />
                <div className="skeleton-line skeleton-meta" />
              </div>
            ))}
          </div>
        ) : notesStatus === "error" ? (
          <div className="vault-note-list-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <span>노트를 불러오지 못했습니다</span>
          </div>
        ) : displayNotes.length === 0 ? (
          <div className="vault-note-list-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <polyline points="14 2 14 8 20 8" />
            </svg>
            <span>{isSearching ? "검색 결과가 없습니다" : "노트가 없습니다"}</span>
          </div>
        ) : (
          displayNotes.map((note) => (
            <NoteListItem
              key={note.id}
              note={note}
              isSelected={selectedNote?.id === note.id}
              onClick={() => selectNote(note.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}
