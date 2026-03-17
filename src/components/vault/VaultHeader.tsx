import { BookOpen, List, Share2, Plus, ExternalLink } from "lucide-react";
import type { Agent } from "../../services/types";

interface VaultHeaderProps {
  viewMode: "list" | "graph";
  onViewModeChange: (mode: "list" | "graph") => void;
  onCreateNote: () => void;
  onOpenObsidian: () => void;
  agents: Agent[];
  selectedAgentId: string | null;
  onAgentChange: (agentId: string | null) => void;
}

export default function VaultHeader({
  viewMode,
  onViewModeChange,
  onCreateNote,
  onOpenObsidian,
  agents,
  selectedAgentId,
  onAgentChange,
}: VaultHeaderProps) {
  return (
    <div className="vault-header">
      <BookOpen size={20} />
      <h2>볼트</h2>

      <select
        className="vault-agent-select"
        value={selectedAgentId ?? ""}
        onChange={(e) => onAgentChange(e.target.value || null)}
      >
        <option value="">전체</option>
        {agents.map((agent) => (
          <option key={agent.id} value={agent.id}>
            {agent.name}
          </option>
        ))}
      </select>

      <div className="vault-view-toggle">
        <button
          className={viewMode === "list" ? "active" : ""}
          onClick={() => onViewModeChange("list")}
        >
          <List size={14} />
          목록
        </button>
        <button
          className={viewMode === "graph" ? "active" : ""}
          onClick={() => onViewModeChange("graph")}
        >
          <Share2 size={14} />
          그래프
        </button>
      </div>

      <div className="vault-header-actions">
        <button
          className="icon-btn"
          onClick={onCreateNote}
          title="새 노트"
        >
          <Plus size={18} />
        </button>
        <button
          className="icon-btn"
          onClick={onOpenObsidian}
          title="Obsidian에서 열기"
        >
          <ExternalLink size={18} />
        </button>
      </div>
    </div>
  );
}
