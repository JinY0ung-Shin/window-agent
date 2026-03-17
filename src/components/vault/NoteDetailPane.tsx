import { useState } from "react";
import { Pencil, Trash2, ExternalLink } from "lucide-react";
import type { VaultNote } from "../../services/vaultTypes";
import { useVaultStore } from "../../stores/vaultStore";
import NoteMetadataBar from "./NoteMetadataBar";
import NoteContent from "./NoteContent";
import BacklinksSection from "./BacklinksSection";

interface NoteDetailPaneProps {
  note: VaultNote;
  onEdit: () => void;
  onDelete: () => void;
  onTagClick?: (tag: string) => void;
  onWikilinkClick?: (target: string) => void;
  onNavigate?: (noteId: string) => void;
  onOpenInObsidian?: () => void;
}

export default function NoteDetailPane({
  note,
  onEdit,
  onDelete,
  onTagClick,
  onWikilinkClick,
  onNavigate,
  onOpenInObsidian,
}: NoteDetailPaneProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const allNotes = useVaultStore((s) => s.notes);

  const handleWikilinkClick = (target: string) => {
    onWikilinkClick?.(target);
  };

  const handleNavigate = (noteId: string) => {
    onNavigate?.(noteId);
  };

  return (
    <div className="vault-detail-pane">
      <NoteMetadataBar note={note} onTagClick={onTagClick} />

      <NoteContent
        content={note.content}
        notes={allNotes}
        onWikilinkClick={handleWikilinkClick}
      />

      <BacklinksSection noteId={note.id} onNavigate={handleNavigate} />

      <div className="vault-detail-actions">
        <button className="vault-action-btn" onClick={onEdit}>
          <Pencil size={14} />
          편집
        </button>

        {!confirmDelete ? (
          <button
            className="vault-action-btn vault-action-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />
            삭제
          </button>
        ) : (
          <div className="vault-delete-confirm">
            <span>정말 삭제하시겠습니까?</span>
            <button
              className="vault-action-btn vault-action-danger"
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
            >
              확인
            </button>
            <button
              className="vault-action-btn"
              onClick={() => setConfirmDelete(false)}
            >
              취소
            </button>
          </div>
        )}

        {onOpenInObsidian && (
          <button className="vault-action-btn" onClick={onOpenInObsidian}>
            <ExternalLink size={14} />
            Obsidian에서 열기
          </button>
        )}
      </div>
    </div>
  );
}
