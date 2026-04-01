import { useTranslation } from "react-i18next";

interface NoteFilterBarProps {
  activeCategory: string | null;
  activeTags: string[];
  availableCategories: string[];
  availableTags: string[];
  onCategoryChange: (cat: string | null) => void;
  onTagsChange: (tags: string[]) => void;
  collapsed?: boolean;
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

export default function NoteFilterBar({
  activeCategory,
  activeTags,
  availableCategories,
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
      {availableCategories.length > 0 && (
        <div className="vault-filter-categories">
          {availableCategories.map((cat) => {
            const color = categoryColor(cat);
            return (
              <button
                key={cat}
                className={`vault-filter-chip${activeCategory === cat ? " active" : ""}`}
                style={{ "--chip-color": color } as React.CSSProperties}
                onClick={() =>
                  onCategoryChange(activeCategory === cat ? null : cat)
                }
              >
                <span
                  className="vault-filter-chip-dot"
                  style={{ background: color }}
                />
                {t(`category.${cat}`, { defaultValue: cat })}
              </button>
            );
          })}
        </div>
      )}
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
