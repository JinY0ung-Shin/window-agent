import type { NoteType } from "../../services/vaultTypes";

interface NoteFilterBarProps {
  activeCategory: NoteType | null;
  activeTags: string[];
  availableTags: string[];
  onCategoryChange: (cat: NoteType | null) => void;
  onTagsChange: (tags: string[]) => void;
  collapsed?: boolean;
}

const CATEGORIES: { key: NoteType; label: string; cssVar: string }[] = [
  { key: "knowledge", label: "지식", cssVar: "var(--vault-knowledge)" },
  { key: "decision", label: "결정", cssVar: "var(--vault-decision)" },
  { key: "conversation", label: "대화", cssVar: "var(--vault-conversation)" },
  { key: "reflection", label: "회고", cssVar: "var(--vault-reflection)" },
];

export default function NoteFilterBar({
  activeCategory,
  activeTags,
  availableTags,
  onCategoryChange,
  onTagsChange,
  collapsed,
}: NoteFilterBarProps) {
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
            {cat.label}
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
