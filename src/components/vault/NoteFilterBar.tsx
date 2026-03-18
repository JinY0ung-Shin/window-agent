import { useTranslation } from "react-i18next";
import type { NoteType } from "../../services/vaultTypes";

interface NoteFilterBarProps {
  activeCategory: NoteType | null;
  activeTags: string[];
  availableTags: string[];
  onCategoryChange: (cat: NoteType | null) => void;
  onTagsChange: (tags: string[]) => void;
  collapsed?: boolean;
}

const CATEGORIES: { key: NoteType; cssVar: string }[] = [
  { key: "knowledge", cssVar: "var(--vault-knowledge)" },
  { key: "decision", cssVar: "var(--vault-decision)" },
  { key: "conversation", cssVar: "var(--vault-conversation)" },
  { key: "reflection", cssVar: "var(--vault-reflection)" },
];

export default function NoteFilterBar({
  activeCategory,
  activeTags,
  availableTags,
  onCategoryChange,
  onTagsChange,
  collapsed,
}: NoteFilterBarProps) {
  const { t } = useTranslation("vault");
  if (collapsed) return null;

  const toggleTag = (tag: string) => {
    if (activeTags.includes(tag)) {
      onTagsChange(activeTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...activeTags, tag]);
    }
  };

  return (
    <div className="vault-filter-bar">
      <div className="vault-filter-categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`vault-filter-chip${activeCategory === cat.key ? " active" : ""}`}
            style={{
              "--chip-color": cat.cssVar,
            } as React.CSSProperties}
            onClick={() =>
              onCategoryChange(activeCategory === cat.key ? null : cat.key)
            }
          >
            <span
              className="vault-filter-chip-dot"
              style={{ background: cat.cssVar }}
            />
            {t(`category.${cat.key}`)}
          </button>
        ))}
      </div>
      {availableTags.length > 0 && (
        <div className="vault-filter-tags">
          {availableTags.map((tag) => (
            <button
              key={tag}
              className={`vault-filter-chip vault-filter-chip-tag${activeTags.includes(tag) ? " active" : ""}`}
              onClick={() => toggleTag(tag)}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
