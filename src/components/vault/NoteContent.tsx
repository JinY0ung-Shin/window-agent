import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { VaultNoteSummary } from "../../services/vaultTypes";

interface NoteContentProps {
  content: string;
  notes: VaultNoteSummary[]; // for wikilink resolution
  onWikilinkClick: (noteId: string) => void;
}

/** Build a lookup map: title (lowercase) -> noteId, plus id -> id for direct matches. */
function buildLinkMap(notes: VaultNoteSummary[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const n of notes) {
    map.set(n.id, n.id); // direct ID match
    map.set(n.title.toLowerCase(), n.id); // title match (case-insensitive)
  }
  return map;
}

/** Parse text containing [[target|display]] wikilinks into mixed React nodes. */
function renderWikilinks(
  text: string,
  linkMap: Map<string, string>,
  onClick: (noteId: string) => void,
  linkNotFoundFn?: (target: string) => string,
): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push(text.slice(last, match.index));
    }
    const target = match[1];
    const display = match[2] ?? target;
    // Resolve: try direct ID, then case-insensitive title
    const resolvedId = linkMap.get(target) ?? linkMap.get(target.toLowerCase());
    const isResolved = !!resolvedId;

    parts.push(
      <span
        key={`wl-${match.index}`}
        className={`vault-wikilink ${isResolved ? "resolved" : "broken"}`}
        role="link"
        tabIndex={0}
        title={isResolved ? display : (linkNotFoundFn ? linkNotFoundFn(target) : target)}
        onClick={() => {
          if (resolvedId) onClick(resolvedId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && resolvedId) onClick(resolvedId);
        }}
      >
        {display}
      </span>,
    );
    last = re.lastIndex;
  }

  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts;
}

export default function NoteContent({ content, notes, onWikilinkClick }: NoteContentProps) {
  const { t } = useTranslation("vault");
  const linkMap = useMemo(() => buildLinkMap(notes), [notes]);
  const linkNotFoundFn = useCallback((target: string) => t("note.linkNotFound", { target }), [t]);

  const components = useMemo(
    () => ({
      p: ({ children, ...props }: React.ComponentPropsWithoutRef<"p">) => (
        <p {...props}>{processChildren(children, linkMap, onWikilinkClick, linkNotFoundFn)}</p>
      ),
      li: ({ children, ...props }: React.ComponentPropsWithoutRef<"li">) => (
        <li {...props}>{processChildren(children, linkMap, onWikilinkClick, linkNotFoundFn)}</li>
      ),
      td: ({ children, ...props }: React.ComponentPropsWithoutRef<"td">) => (
        <td {...props}>{processChildren(children, linkMap, onWikilinkClick, linkNotFoundFn)}</td>
      ),
    }),
    [linkMap, onWikilinkClick, linkNotFoundFn],
  );

  return (
    <div className="vault-note-content markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </Markdown>
    </div>
  );
}

/** Walk children and expand wikilinks found in string nodes. */
function processChildren(
  children: ReactNode,
  linkMap: Map<string, string>,
  onClick: (noteId: string) => void,
  linkNotFoundFn?: (target: string) => string,
): ReactNode {
  if (!children) return children;
  if (typeof children === "string") {
    const parts = renderWikilinks(children, linkMap, onClick, linkNotFoundFn);
    return parts.length === 1 ? parts[0] : <>{parts}</>;
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? (
        <span key={i}>{processChildren(child, linkMap, onClick, linkNotFoundFn)}</span>
      ) : (
        child
      ),
    );
  }
  return children;
}
