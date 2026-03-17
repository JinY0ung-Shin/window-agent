import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { vaultGetBacklinks } from "../../services/commands/vaultCommands";
import type { LinkRef } from "../../services/vaultTypes";

interface BacklinksSectionProps {
  noteId: string;
  onNavigate: (noteId: string) => void;
}

export default function BacklinksSection({ noteId, onNavigate }: BacklinksSectionProps) {
  const [backlinks, setBacklinks] = useState<LinkRef[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    vaultGetBacklinks(noteId)
      .then((links) => {
        if (!cancelled) {
          setBacklinks(links);
          setExpanded(links.length > 0);
        }
      })
      .catch(() => {
        if (!cancelled) setBacklinks([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [noteId]);

  return (
    <div className="vault-backlinks">
      <button
        className="vault-backlinks-header"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>백링크 ({loading ? "…" : backlinks.length})</span>
      </button>

      {expanded && (
        <div className="vault-backlinks-list">
          {backlinks.length === 0 && !loading && (
            <div className="vault-backlinks-empty">
              이 노트를 참조하는 다른 노트가 없습니다
            </div>
          )}
          {backlinks.map((link) => (
            <button
              key={`${link.sourceId}-${link.lineNumber}`}
              className="vault-backlink-item"
              onClick={() => onNavigate(link.sourceId)}
            >
              <span className="vault-backlink-title">
                {link.displayText ?? link.rawLink}
              </span>
              <span className="vault-backlink-line">L{link.lineNumber}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
