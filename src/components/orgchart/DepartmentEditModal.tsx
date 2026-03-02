import { useEffect, useState } from "react";
import { useOrgChartStore } from "../../stores/orgChartStore";
import { Button } from "../ui/Button";
import { ModalShell } from "../ui/ModalShell";

export function DepartmentEditModal() {
  const {
    showDeptModal,
    editingDept,
    closeDeptModal,
    createDepartment,
    updateDepartment,
  } = useOrgChartStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (editingDept) {
      setName(editingDept.name);
      setDescription(editingDept.description);
      return;
    }
    setName("");
    setDescription("");
  }, [editingDept, showDeptModal]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    if (editingDept) {
      await updateDepartment(editingDept.id, name, description);
    } else {
      await createDepartment(name, description);
    }
  };

  return (
    <ModalShell
      isOpen={showDeptModal}
      onClose={closeDeptModal}
      title={editingDept ? "부서 수정" : "새 부서 추가"}
      size="md"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={closeDeptModal}>
            취소
          </Button>
          <Button onClick={handleSubmit} disabled={!name.trim()}>
            {editingDept ? "수정" : "추가"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs text-text-muted">부서명</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="부서명을 입력하세요"
            className="w-full rounded-lg border border-white/[0.08] bg-surface-700/45 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-500/55 focus:outline-none"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs text-text-muted">설명</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="부서 설명을 입력하세요"
            rows={3}
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-surface-700/45 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-500/55 focus:outline-none"
          />
        </div>
      </div>
    </ModalShell>
  );
}
