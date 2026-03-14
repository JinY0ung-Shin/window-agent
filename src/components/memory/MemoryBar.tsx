import { useEffect, useState, useRef } from "react";
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Check, X } from "lucide-react";
import { useMemoryStore } from "../../stores/memoryStore";

interface Props {
  agentId: string | null;
}

export default function MemoryBar({ agentId }: Props) {
  const notes = useMemoryStore((s) => s.notes) ?? [];
  const currentAgentId = useMemoryStore((s) => s.currentAgentId);
  const loadNotes = useMemoryStore((s) => s.loadNotes);
  const addNote = useMemoryStore((s) => s.addNote);
  const editNote = useMemoryStore((s) => s.editNote);
  const removeNote = useMemoryStore((s) => s.removeNote);

  const [expanded, setExpanded] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const newTitleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (agentId && agentId !== currentAgentId) {
      loadNotes(agentId);
    }
  }, [agentId, currentAgentId, loadNotes]);

  useEffect(() => {
    if (adding && newTitleRef.current) {
      newTitleRef.current.focus();
    }
  }, [adding]);

  useEffect(() => {
    if (editingId && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, [editingId]);

  if (!agentId) return null;

  const handleAdd = async () => {
    if (!newTitle.trim()) return;
    try {
      await addNote(agentId, newTitle.trim(), newContent.trim());
      setNewTitle("");
      setNewContent("");
      setAdding(false);
    } catch (e) {
      console.error("Failed to add memory note:", e);
    }
  };

  const handleEdit = async (id: string) => {
    try {
      await editNote(id, editTitle.trim() || undefined, editContent.trim());
      setEditingId(null);
    } catch (e) {
      console.error("Failed to edit memory note:", e);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removeNote(id);
      setConfirmDeleteId(null);
    } catch (e) {
      console.error("Failed to delete memory note:", e);
    }
  };

  const startEdit = (note: { id: string; title: string; content: string }) => {
    setEditingId(note.id);
    setEditTitle(note.title);
    setEditContent(note.content);
    setAdding(false);
  };

  return (
    <div className="memory-bar">
      <button
        className="memory-bar-toggle"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span>메모리 {notes.length}개</span>
      </button>

      {expanded && (
        <div className="memory-bar-content">
          {notes.map((note) =>
            editingId === note.id ? (
              <div key={note.id} className="memory-note-edit">
                <input
                  ref={titleInputRef}
                  className="memory-note-input"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  placeholder="제목"
                />
                <textarea
                  className="memory-note-textarea"
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  placeholder="내용"
                  rows={2}
                />
                <div className="memory-note-actions">
                  <button onClick={() => handleEdit(note.id)} title="저장">
                    <Check size={14} />
                  </button>
                  <button onClick={() => setEditingId(null)} title="취소">
                    <X size={14} />
                  </button>
                </div>
              </div>
            ) : (
              <div key={note.id} className="memory-note-item">
                <div className="memory-note-text">
                  <span className="memory-note-title">{note.title}</span>
                  {note.content && (
                    <span className="memory-note-preview">
                      {note.content.length > 60
                        ? note.content.slice(0, 60) + "..."
                        : note.content}
                    </span>
                  )}
                </div>
                <div className="memory-note-actions">
                  <button onClick={() => startEdit(note)} title="편집">
                    <Pencil size={12} />
                  </button>
                  {confirmDeleteId === note.id ? (
                    <>
                      <button
                        className="memory-note-delete-confirm"
                        onClick={() => handleDelete(note.id)}
                        title="삭제 확인"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        title="취소"
                      >
                        <X size={12} />
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(note.id)}
                      title="삭제"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              </div>
            ),
          )}

          {adding ? (
            <div className="memory-note-edit">
              <input
                ref={newTitleRef}
                className="memory-note-input"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="제목"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setAdding(false);
                }}
              />
              <textarea
                className="memory-note-textarea"
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="내용"
                rows={2}
              />
              <div className="memory-note-actions">
                <button onClick={handleAdd} title="추가">
                  <Check size={14} />
                </button>
                <button onClick={() => setAdding(false)} title="취소">
                  <X size={14} />
                </button>
              </div>
            </div>
          ) : (
            <button
              className="memory-note-add-btn"
              onClick={() => {
                setAdding(true);
                setEditingId(null);
              }}
            >
              <Plus size={14} />
              <span>메모리 추가</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
