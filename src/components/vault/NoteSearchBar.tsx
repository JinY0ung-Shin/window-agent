import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";

interface NoteSearchBarProps {
  value: string;
  scope: "all" | "self" | "shared";
  onValueChange: (v: string) => void;
  onScopeChange: (s: "all" | "self" | "shared") => void;
  onClear: () => void;
}

const SCOPE_KEYS: ("all" | "self" | "shared")[] = ["all", "self", "shared"];

export default function NoteSearchBar({
  value,
  scope,
  onValueChange,
  onScopeChange,
  onClear,
}: NoteSearchBarProps) {
  const { t } = useTranslation("vault");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const showScope = focused || value.length > 0;
  const { compositionProps } = useCompositionInput(onValueChange);

  return (
    <div className="vault-search-bar">
      <div className="vault-search-input-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="vault-search-icon">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          ref={inputRef}
          type="text"
          className="vault-search-input"
          placeholder={t("search.placeholder")}
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...compositionProps}
        />
        {value && (
          <button className="vault-search-clear" onClick={onClear} title={t("search.clearTitle")}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {showScope && (
        <div className="vault-scope-toggle">
          {SCOPE_KEYS.map((key) => (
            <button
              key={key}
              className={scope === key ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onScopeChange(key)}
            >
              {t(`search.${key}`)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
