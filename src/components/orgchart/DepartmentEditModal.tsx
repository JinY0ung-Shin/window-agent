import { useEffect, useState } from "react";
import { useOrgChartStore } from "../../stores/orgChartStore";

export function DepartmentEditModal() {
  const { showDeptModal, editingDept, closeDeptModal, createDepartment, updateDepartment } =
    useOrgChartStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (editingDept) {
      setName(editingDept.name);
      setDescription(editingDept.description);
    } else {
      setName("");
      setDescription("");
    }
  }, [editingDept, showDeptModal]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDeptModal();
    };
    if (showDeptModal) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showDeptModal, closeDeptModal]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (editingDept) {
      await updateDepartment(editingDept.id, name, description);
    } else {
      await createDepartment(name, description);
    }
  };

  if (!showDeptModal) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closeDeptModal}
      />
      <div className="relative bg-surface-800 border border-white/[0.06] rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4">
        <h2 className="text-lg font-semibold text-text-primary mb-4">
          {editingDept ? "부서 수정" : "새 부서 추가"}
        </h2>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              부서명
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="부서명을 입력하세요"
              className="w-full px-3 py-2 bg-surface-700/40 border border-white/[0.06] rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50"
            />
          </div>
          <div>
            <label className="block text-xs text-text-muted mb-1.5">
              설명
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="부서 설명을 입력하세요"
              rows={3}
              className="w-full px-3 py-2 bg-surface-700/40 border border-white/[0.06] rounded-lg text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            onClick={closeDeptModal}
            className="px-4 py-2 bg-surface-700 hover:bg-surface-600 text-text-primary text-sm rounded-lg transition-colors"
          >
            취소
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {editingDept ? "수정" : "추가"}
          </button>
        </div>
      </div>
    </div>
  );
}
