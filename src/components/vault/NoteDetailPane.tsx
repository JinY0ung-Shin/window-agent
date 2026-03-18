import { useState } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("vault");
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
          {t("detail.edit")}
        </button>

        {!confirmDelete ? (
          <button
            className="vault-action-btn vault-action-danger"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={14} />
            {t("detail.delete")}
          </button>
        ) : (
          <div className="vault-delete-confirm">
            <span>{t("detail.confirmDelete")}</span>
            <button
              className="vault-action-btn vault-action-danger"
              onClick={() => {
                onDelete();
                setConfirmDelete(false);
              }}
            >
              {t("detail.confirm")}
            </button>
            <button
              className="vault-action-btn"
              onClick={() => setConfirmDelete(false)}
            >
              {t("common:cancel")}
            </button>
          </div>
        )}

        {onOpenInObsidian && (
          <button className="vault-action-btn" onClick={onOpenInObsidian}>
            <ExternalLink size={14} />
            {t("detail.openObsidian")}
          </button>
        )}
      </div>
    </div>
  );
}
