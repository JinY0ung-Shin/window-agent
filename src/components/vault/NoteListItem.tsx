import type { VaultNoteSummary } from "../../services/vaultTypes";

interface NoteListItemProps {
  note: VaultNoteSummary;
  isSelected: boolean;
  onClick: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  knowledge: "지식",
  decision: "결정",
  conversation: "대화",
  reflection: "회고",
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "방금";
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay}일 전`;
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

export default function NoteListItem({ note, isSelected, onClick }: NoteListItemProps) {
  const categoryColor = `var(--vault-${note.noteType})`;

  return (
    <div
      className={`vault-note-item${isSelected ? " selected" : ""}`}
      onClick={onClick}
    >
      <div className="vault-note-item-title">{note.title}</div>
      <div className="vault-note-item-preview">{note.bodyPreview}</div>
      <div className="vault-note-item-meta">
        <span
          className="vault-category-badge"
          style={{ background: categoryColor }}
        >
          {CATEGORY_LABELS[note.noteType] ?? note.noteType}
        </span>
        <span className="vault-confidence-bar-wrap">
          <span
            className="vault-confidence-bar"
            style={{ width: `${note.confidence * 100}%`, background: categoryColor }}
          />
        </span>
        <span className="vault-note-item-date">
          {formatRelativeDate(note.updated)}
        </span>
      </div>
    </div>
  );
}
