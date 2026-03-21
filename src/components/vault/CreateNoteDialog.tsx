import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import Modal from "../common/Modal";
import type { NoteType, NoteScope } from "../../services/vaultTypes";
import { useVaultStore } from "../../stores/vaultStore";

interface CreateNoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAgentId: string | null;
}

const CATEGORY_KEYS: NoteType[] = ["knowledge", "decision", "conversation", "reflection"];

export default function CreateNoteDialog({
  isOpen,
  onClose,
  defaultAgentId,
}: CreateNoteDialogProps) {
  const { t } = useTranslation("vault");
  const createNote = useVaultStore((s) => s.createNote);

  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<NoteType>("knowledge");
  const [scope, setScope] = useState<NoteScope>("agent");
  const [tags, setTags] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleComposition = useCompositionInput(useCallback((v: string) => setTitle(v), []));
  const tagsComposition = useCompositionInput(useCallback((v: string) => setTags(v), []));
  const contentComposition = useCompositionInput(useCallback((v: string) => setContent(v), []));

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t("create.titleRequired"));
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const parsedTags = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await createNote({
        agentId: defaultAgentId ?? "user",
        scope,
        category,
        title: title.trim(),
        content,
        tags: parsedTags.length > 0 ? parsedTags : undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("create.failed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      onClose={onClose}
      title={t("create.title")}
      overlayClose="stopPropagation"
      contentClassName="vault-create-dialog"
    >
      <form onSubmit={handleSubmit}>
          {/* Title */}
          <div className="vault-create-field">
            <label>{t("create.titleLabel")}</label>
            <input
              type="text"
              value={title}
              placeholder={t("create.titlePlaceholder")}
              autoFocus
              {...titleComposition.compositionProps}
            />
          </div>

          {/* Category */}
          <div className="vault-create-field">
            <label>{t("create.categoryLabel")}</label>
            <div className="vault-create-radio-group">
              {CATEGORY_KEYS.map((key) => (
                <label key={key} className="vault-create-radio">
                  <input
                    type="radio"
                    name="category"
                    value={key}
                    checked={category === key}
                    onChange={() => setCategory(key)}
                  />
                  {t(`category.${key}`)}
                </label>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div className="vault-create-field">
            <label>{t("create.scopeLabel")}</label>
            <div className="vault-create-radio-group">
              <label className="vault-create-radio">
                <input
                  type="radio"
                  name="scope"
                  value="agent"
                  checked={scope === "agent"}
                  onChange={() => setScope("agent")}
                />
                {t("create.agentOnly")}
              </label>
              <label className="vault-create-radio">
                <input
                  type="radio"
                  name="scope"
                  value="shared"
                  checked={scope === "shared"}
                  onChange={() => setScope("shared")}
                />
                {t("create.shared")}
              </label>
            </div>
          </div>

          {/* Tags */}
          <div className="vault-create-field">
            <label>{t("create.tagsLabel")}</label>
            <input
              type="text"
              value={tags}
              placeholder={t("create.tagsSeparator")}
              {...tagsComposition.compositionProps}
            />
          </div>

          {/* Content */}
          <div className="vault-create-field">
            <label>{t("create.contentLabel")}</label>
            <textarea
              rows={4}
              value={content}
              placeholder={t("create.contentPlaceholder")}
              {...contentComposition.compositionProps}
            />
          </div>

          {error && <div className="vault-create-error">{error}</div>}

          <div className="vault-create-dialog-actions">
            <button
              type="button"
              className="vault-btn vault-btn-secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              {t("common:cancel")}
            </button>
            <button
              type="submit"
              className="vault-btn vault-btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? t("create.creating") : t("create.submit")}
            </button>
          </div>
      </form>
    </Modal>
  );
}
