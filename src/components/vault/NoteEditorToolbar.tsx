import { useTranslation } from "react-i18next";
import { Bold, Italic, Heading1, Heading2, Heading3, Link2, Eye, EyeOff } from "lucide-react";

interface NoteEditorToolbarProps {
  onBold: () => void;
  onItalic: () => void;
  onHeading: (level: 1 | 2 | 3) => void;
  onWikilink: () => void;
  onTogglePreview: () => void;
  showPreview: boolean;
}

export default function NoteEditorToolbar({
  onBold,
  onItalic,
  onHeading,
  onWikilink,
  onTogglePreview,
  showPreview,
}: NoteEditorToolbarProps) {
  const { t } = useTranslation("vault");
  return (
    <div className="vault-editor-toolbar">
      <button type="button" className="icon-btn icon-btn-sm" title="Bold (Ctrl+B)" onClick={onBold}>
        <Bold size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" title="Italic (Ctrl+I)" onClick={onItalic}>
        <Italic size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" title="Heading 1" onClick={() => onHeading(1)}>
        <Heading1 size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" title="Heading 2" onClick={() => onHeading(2)}>
        <Heading2 size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" title="Heading 3" onClick={() => onHeading(3)}>
        <Heading3 size={16} />
      </button>
      <button type="button" className="icon-btn icon-btn-sm" title="Wikilink" onClick={onWikilink}>
        <Link2 size={16} />
      </button>

      <span className="vault-editor-toolbar-divider" />

      <button type="button" className="icon-btn icon-btn-sm" title={t("toolbar.togglePreview")} onClick={onTogglePreview}>
        {showPreview ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
