import { useState, useRef } from "react";
import { useCompositionInput } from "../../hooks/useCompositionInput";

interface NoteSearchBarProps {
  value: string;
  scope: "all" | "self" | "shared";
  onValueChange: (v: string) => void;
  onScopeChange: (s: "all" | "self" | "shared") => void;
  onClear: () => void;
}

const SCOPES: { key: "all" | "self" | "shared"; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "self", label: "내 노트" },
  { key: "shared", label: "공유" },
];

export default function NoteSearchBar({
  value,
  scope,
  onValueChange,
  onScopeChange,
  onClear,
}: NoteSearchBarProps) {
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
          placeholder="노트 검색..."
          value={value}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          {...compositionProps}
        />
        {value && (
          <button className="vault-search-clear" onClick={onClear} title="지우기">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
      </div>
      {showScope && (
        <div className="vault-scope-toggle">
          {SCOPES.map((s) => (
            <button
              key={s.key}
              className={scope === s.key ? "active" : ""}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onScopeChange(s.key)}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
