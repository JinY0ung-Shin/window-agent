import { useState } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2, Bot, Tag, Trash2, Download } from "lucide-react";
import { useHubStore } from "../../stores/hubStore";
import EmptyState from "../common/EmptyState";
import HubInstallPopover from "./HubInstallPopover";
import type { SharedNote } from "../../services/commands/hubCommands";

function NoteCard({ note }: { note: SharedNote }) {
  const { t } = useTranslation("hub");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const userId = useHubStore((s) => s.userId);
  const loggedIn = useHubStore((s) => s.loggedIn);
  const deleteSharedNote = useHubStore((s) => s.deleteSharedNote);
  const isOwner = userId === note.user_id;

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <BookOpen size={18} className="hub-card-icon" />
        <div className="hub-card-title">{note.title}</div>
        {note.note_type && (
          <span className="hub-badge-type">{note.note_type}</span>
        )}
        <div className="hub-card-actions">
          {loggedIn && (
            <div className="hub-install-wrapper">
              <button

                className="hub-card-install"
                onClick={() => setShowInstall(!showInstall)}
                title={t("install.button")}
              >
                <Download size={14} />
              </button>
              {showInstall && (
                <HubInstallPopover
                  type="note"
                  note={note}
                  onClose={() => setShowInstall(false)}

                />
              )}
            </div>
          )}
          {isOwner && (
            <>
              {confirmDelete ? (
                <div className="hub-delete-confirm">
                  <button
                    className="btn-danger-sm"
                    onClick={() => deleteSharedNote(note.id)}
                  >
                    {t("delete.confirm")}
                  </button>
                  <button
                    className="btn-secondary-sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    {t("delete.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  className="hub-card-delete"
                  onClick={() => setConfirmDelete(true)}
                  title={t("delete.note")}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {note.tags.length > 0 && (
        <div className="hub-card-tags">
          {note.tags.map((tag) => (
            <span key={tag} className="hub-tag">
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="hub-card-footer">
        <span className="hub-card-author">{note.display_name}</span>
        {note.agent_name && (
          <span className="hub-card-agent">
            <Bot size={12} />
            {note.agent_name}
          </span>
        )}
      </div>
    </div>
  );
}

export default function HubNoteList() {
  const { t } = useTranslation("hub");
  const notes = useHubStore((s) => s.notes);
  const notesLoading = useHubStore((s) => s.notesLoading);

  if (notesLoading && notes.length === 0) {
    return (
      <div className="hub-loading">
        <Loader2 size={24} className="hub-spinner" />
      </div>
    );
  }

  if (notes.length === 0) {
    return (
      <EmptyState
        icon={<BookOpen size={40} strokeWidth={1.5} />}
        message={t("empty.notes")}
        hint={t("empty.notesHint")}
        className="hub-empty"
      />
    );
  }

  return (
    <div className="hub-card-grid">
      {notes.map((note) => (
        <NoteCard key={note.id} note={note} />
      ))}
    </div>
  );
}
