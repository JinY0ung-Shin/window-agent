import { useCallback, useEffect, useState } from "react";
import { useVaultStore } from "../../stores/vaultStore";
import { useAgentStore } from "../../stores/agentStore";
import VaultHeader from "./VaultHeader";
import VaultEmptyState from "./VaultEmptyState";
import NoteListPane from "./NoteListPane";
import NoteDetailPane from "./NoteDetailPane";
import NoteEditor from "./NoteEditor";
import GraphPane from "./GraphPane";
import CreateNoteDialog from "./CreateNoteDialog";

export default function VaultPanel() {
  const agents = useAgentStore((s) => s.agents);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);

  const selectedNote = useVaultStore((s) => s.selectedNote);
  const loadNotes = useVaultStore((s) => s.loadNotes);
  const updateNote = useVaultStore((s) => s.updateNote);
  const deleteNote = useVaultStore((s) => s.deleteNote);
  const selectNote = useVaultStore((s) => s.selectNote);
  const clearSelection = useVaultStore((s) => s.clearSelection);
  const openInObsidian = useVaultStore((s) => s.openInObsidian);
  const setActiveAgent = useVaultStore((s) => s.setActiveAgent);
  const setActiveTags = useVaultStore((s) => s.setActiveTags);

  const [viewMode, setViewMode] = useState<"list" | "graph">("list");
  const [isEditing, setIsEditing] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [vaultAgentId, setVaultAgentId] = useState<string | null>(
    selectedAgentId,
  );

  // Load notes when the vault agent changes
  useEffect(() => {
    loadNotes(vaultAgentId ?? undefined);
    setActiveAgent(vaultAgentId);
  }, [vaultAgentId, loadNotes, setActiveAgent]);

  // Reset editing state when selected note changes
  useEffect(() => {
    setIsEditing(false);
  }, [selectedNote?.id]);

  const handleAgentChange = useCallback(
    (agentId: string | null) => {
      setVaultAgentId(agentId);
      clearSelection();
    },
    [clearSelection],
  );

  const handleDelete = useCallback(() => {
    if (selectedNote) {
      deleteNote(selectedNote.id);
    }
  }, [selectedNote, deleteNote]);

  const handleGraphNodeClick = useCallback(
    (noteId: string) => {
      selectNote(noteId);
      setViewMode("list");
    },
    [selectNote],
  );

  const handleWikilinkClick = useCallback(
    (target: string) => {
      selectNote(target);
    },
    [selectNote],
  );

  const handleTagClick = useCallback(
    (tag: string) => {
      setActiveTags([tag]);
    },
    [setActiveTags],
  );

  // Determine right pane content
  const renderRightPane = () => {
    if (viewMode === "graph") {
      return <GraphPane onNodeClick={handleGraphNodeClick} />;
    }

    if (!selectedNote) {
      return <VaultEmptyState />;
    }

    if (isEditing) {
      return (
        <NoteEditor
          note={selectedNote}
          onSave={(updates) => {
            updateNote(selectedNote.id, updates);
            setIsEditing(false);
          }}
          onCancel={() => setIsEditing(false)}
        />
      );
    }

    return (
      <NoteDetailPane
        note={selectedNote}
        onEdit={() => setIsEditing(true)}
        onDelete={handleDelete}
        onTagClick={handleTagClick}
        onWikilinkClick={handleWikilinkClick}
        onNavigate={selectNote}
        onOpenInObsidian={openInObsidian}
      />
    );
  };

  return (
    <div className="vault-panel">
      <VaultHeader
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCreateNote={() => setShowCreateDialog(true)}
        onOpenObsidian={openInObsidian}
        agents={agents}
        selectedAgentId={vaultAgentId}
        onAgentChange={handleAgentChange}
      />

      <div className="vault-body">
        <NoteListPane />
        {renderRightPane()}
      </div>

      <CreateNoteDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        defaultAgentId={vaultAgentId}
      />
    </div>
  );
}
