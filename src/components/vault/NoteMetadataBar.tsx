import { Bot } from "lucide-react";
import type { VaultNote } from "../../services/vaultTypes";

interface NoteMetadataBarProps {
  note: VaultNote;
  onTagClick?: (tag: string) => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  knowledge: "지식",
  conversation: "대화",
  decision: "결정",
  reflection: "성찰",
};

const CATEGORY_COLORS: Record<string, string> = {
  knowledge: "var(--vault-knowledge)",
  conversation: "var(--vault-conversation)",
  decision: "var(--vault-decision)",
  reflection: "var(--vault-reflection)",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ko-KR", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function NoteMetadataBar({ note, onTagClick }: NoteMetadataBarProps) {
  const catColor = CATEGORY_COLORS[note.noteType] ?? "var(--text-muted)";

  return (
    <div className="vault-metadata-bar">
      <h2 className="vault-note-title">{note.title}</h2>

      <div className="vault-metadata-row">
        <span className="vault-agent-badge">
          <Bot size={13} />
          {note.agent}
        </span>

        <span
          className="vault-category-badge-lg"
          style={{ background: catColor }}
        >
          {CATEGORY_LABELS[note.noteType] ?? note.noteType}
        </span>

        <div className="vault-confidence-bar-wrap" title={`신뢰도 ${Math.round(note.confidence * 100)}%`}>
          <span
            className="vault-confidence-bar"
            style={{ width: `${note.confidence * 100}%`, background: catColor }}
          />
        </div>
      </div>

      {note.tags.length > 0 && (
        <div className="vault-metadata-tags">
          {note.tags.map((tag) => (
            <button
              key={tag}
              className="vault-tag-chip"
              onClick={() => onTagClick?.(tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <div className="vault-metadata-dates">
        <span>생성 {formatDate(note.created)}</span>
        <span>수정 {formatDate(note.updated)}</span>
      </div>
    </div>
  );
}
