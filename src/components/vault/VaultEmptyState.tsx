import { BookOpen } from "lucide-react";

export default function VaultEmptyState() {
  return (
    <div className="vault-empty-state">
      <BookOpen size={40} strokeWidth={1.5} />
      <p>노트를 선택하거나</p>
      <p>새로 만들어 보세요</p>
    </div>
  );
}
