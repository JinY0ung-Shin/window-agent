import { useTranslation } from "react-i18next";
import type { VaultNoteSummary } from "../../services/vaultTypes";

interface NoteListItemProps {
  note: VaultNoteSummary;
  isSelected: boolean;
  onClick: () => void;
}

export default function NoteListItem({ note, isSelected, onClick }: NoteListItemProps) {
  const { t, i18n } = useTranslation("vault");
  const formatRelativeDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return t("time.justNow");
    if (diffMin < 60) return t("time.minutesAgo", { count: diffMin });
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return t("time.hoursAgo", { count: diffHr });
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return t("time.daysAgo", { count: diffDay });
    return date.toLocaleDateString(i18n.language === "ko" ? "ko-KR" : "en-US", { month: "short", day: "numeric" });
  };

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
          {t(`category.${note.noteType}`, { defaultValue: note.noteType })}
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
