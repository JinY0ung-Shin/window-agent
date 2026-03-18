import { useState, useCallback } from "react";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import type { NoteType, NoteScope } from "../../services/vaultTypes";
import { useVaultStore } from "../../stores/vaultStore";

interface CreateNoteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  defaultAgentId: string | null;
}

const CATEGORY_OPTIONS: { value: NoteType; label: string }[] = [
  { value: "knowledge", label: "지식" },
  { value: "decision", label: "결정" },
  { value: "conversation", label: "대화" },
  { value: "reflection", label: "회고" },
];

export default function CreateNoteDialog({
  isOpen,
  onClose,
  defaultAgentId,
}: CreateNoteDialogProps) {
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
      setError("제목을 입력하세요");
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
      setError(err instanceof Error ? err.message : "노트 생성에 실패했습니다");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content vault-create-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>새 노트 만들기</h3>
        <form onSubmit={handleSubmit}>
          {/* Title */}
          <div className="vault-create-field">
            <label>제목</label>
            <input
              type="text"
              value={title}
              placeholder="노트 제목"
              autoFocus
              {...titleComposition.compositionProps}
            />
          </div>

          {/* Category */}
          <div className="vault-create-field">
            <label>분류</label>
            <div className="vault-create-radio-group">
              {CATEGORY_OPTIONS.map((opt) => (
                <label key={opt.value} className="vault-create-radio">
                  <input
                    type="radio"
                    name="category"
                    value={opt.value}
                    checked={category === opt.value}
                    onChange={() => setCategory(opt.value)}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Scope */}
          <div className="vault-create-field">
            <label>범위</label>
            <div className="vault-create-radio-group">
              <label className="vault-create-radio">
                <input
                  type="radio"
                  name="scope"
                  value="agent"
                  checked={scope === "agent"}
                  onChange={() => setScope("agent")}
                />
                에이전트 전용
              </label>
              <label className="vault-create-radio">
                <input
                  type="radio"
                  name="scope"
                  value="shared"
                  checked={scope === "shared"}
                  onChange={() => setScope("shared")}
                />
                공유
              </label>
            </div>
          </div>

          {/* Tags */}
          <div className="vault-create-field">
            <label>태그</label>
            <input
              type="text"
              value={tags}
              placeholder="쉼표로 구분"
              {...tagsComposition.compositionProps}
            />
          </div>

          {/* Content */}
          <div className="vault-create-field">
            <label>내용</label>
            <textarea
              rows={4}
              value={content}
              placeholder="노트 내용"
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
              취소
            </button>
            <button
              type="submit"
              className="vault-btn vault-btn-primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? "생성 중…" : "만들기"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
