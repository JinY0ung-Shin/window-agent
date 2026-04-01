import { useTranslation } from "react-i18next";
import { Bot } from "lucide-react";
import { i18n } from "../../i18n";
import type { VaultNote } from "../../services/vaultTypes";

interface NoteMetadataBarProps {
  note: VaultNote;
  onTagClick?: (tag: string) => void;
}

/** Generate a stable HSL color from a string. */
function categoryColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 55%, 55%)`;
}

function formatDate(iso: string): string {
  try {
    const intlLocale = i18n.language === "en" ? "en-US" : "ko-KR";
    return new Date(iso).toLocaleDateString(intlLocale, {
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
  const { t } = useTranslation("vault");
  const catColor = categoryColor(note.noteType);

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
          {t(`category.${note.noteType}`, { defaultValue: note.noteType })}
        </span>

        <div className="vault-confidence-bar-wrap" title={t("note.confidence", { percent: Math.round(note.confidence * 100) })}>
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
        <span>{t("note.created", { date: formatDate(note.created) })}</span>
        <span>{t("note.updated", { date: formatDate(note.updated) })}</span>
      </div>
    </div>
  );
}
