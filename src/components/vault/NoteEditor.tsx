import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { VaultNote, NoteUpdates } from "../../services/vaultTypes";
import NoteEditorToolbar from "./NoteEditorToolbar";

interface NoteEditorProps {
  note: VaultNote;
  onSave: (updates: NoteUpdates) => void;
  onCancel: () => void;
}

export default function NoteEditor({ note, onSave, onCancel }: NoteEditorProps) {
  const { t } = useTranslation("vault");
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [tags, setTags] = useState(note.tags.join(", "));
  const [confidence, setConfidence] = useState(note.confidence);
  const [showPreview, setShowPreview] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const titleComposition = useCompositionInput(setTitle);
  const contentComposition = useCompositionInput(setContent);
  const tagsComposition = useCompositionInput(setTags);

  const isDirty =
    title !== note.title ||
    content !== note.content ||
    tags !== note.tags.join(", ") ||
    confidence !== note.confidence;

  const handleSave = useCallback(() => {
    const parsedTags = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    onSave({ title, content, tags: parsedTags, confidence });
  }, [title, content, tags, confidence, onSave]);

  const handleCancel = useCallback(() => {
    if (isDirty && !window.confirm(t("editor.unsavedChanges"))) return;
    onCancel();
  }, [isDirty, onCancel]);

  // Ctrl+S / Cmd+S
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  // ── Toolbar helpers ────────────────────────────────
  const wrapSelection = (before: string, after: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = content.slice(start, end);
    const defaultText = t("editor.defaultText");
    const replacement = `${before}${selected || defaultText}${after}`;
    const next = content.slice(0, start) + replacement + content.slice(end);
    setContent(next);
    // restore cursor after React re-render
    requestAnimationFrame(() => {
      ta.focus();
      const cursorPos = start + before.length;
      const selEnd = cursorPos + (selected || defaultText).length;
      ta.setSelectionRange(cursorPos, selEnd);
    });
  };

  const insertLinePrefix = (prefix: string) => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    // find line start
    const lineStart = content.lastIndexOf("\n", start - 1) + 1;
    const next = content.slice(0, lineStart) + prefix + content.slice(lineStart);
    setContent(next);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + prefix.length, start + prefix.length);
    });
  };

  const handleBold = () => wrapSelection("**", "**");
  const handleItalic = () => wrapSelection("*", "*");
  const handleHeading = (level: 1 | 2 | 3) => insertLinePrefix("#".repeat(level) + " ");
  const handleWikilink = () => wrapSelection("[[", "]]");

  return (
    <div className="vault-editor">
      {/* Title */}
      <input
        className="vault-editor-title"
        value={title}
        placeholder={t("editor.titlePlaceholder")}
        {...titleComposition.compositionProps}
      />

      {/* Toolbar */}
      <NoteEditorToolbar
        onBold={handleBold}
        onItalic={handleItalic}
        onHeading={handleHeading}
        onWikilink={handleWikilink}
        onTogglePreview={() => setShowPreview((p) => !p)}
        showPreview={showPreview}
      />

      {/* Editor + Preview */}
      <div className="vault-editor-body">
        <div className="vault-editor-pane" style={{ display: showPreview ? undefined : "flex", flex: 1 }}>
          <textarea
            ref={textareaRef}
            className="vault-editor-textarea"
            value={content}
            placeholder={t("editor.contentPlaceholder")}
            {...contentComposition.compositionProps}
          />
        </div>
        {showPreview && (
          <div className="vault-editor-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        )}
      </div>

      {/* Footer: meta + actions */}
      <div className="vault-editor-footer">
        <div className="vault-editor-meta-row">
          <label>
            {t("editor.tags")}
            <input
              type="text"
              value={tags}
              placeholder={t("editor.tagsSeparator")}
              {...tagsComposition.compositionProps}
            />
          </label>
          <label className="vault-confidence-label">
            {t("editor.confidence", { percent: Math.round(confidence * 100) })}
            <input
              type="range"
              className="vault-confidence-slider"
              min={0}
              max={1}
              step={0.01}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="vault-editor-actions">
          <button className="vault-btn vault-btn-secondary" onClick={handleCancel}>
            {t("common:cancel")}
          </button>
          <button className="vault-btn vault-btn-primary" onClick={handleSave}>
            {t("common:save")}
          </button>
        </div>
      </div>
    </div>
  );
}
