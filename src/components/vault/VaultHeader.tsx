import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("vault");
  return (
    <div className="vault-header">
      <BookOpen size={20} />
      <h2>{t("header.title")}</h2>

      <select
        className="vault-agent-select"
        value={selectedAgentId ?? ""}
        onChange={(e) => onAgentChange(e.target.value || null)}
      >
        <option value="">{t("header.filterAll")}</option>
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
          {t("header.listView")}
        </button>
        <button
          className={viewMode === "graph" ? "active" : ""}
          onClick={() => onViewModeChange("graph")}
        >
          <Share2 size={14} />
          {t("header.graphView")}
        </button>
      </div>

      <div className="vault-header-actions">
        <button
          className="icon-btn"
          onClick={onCreateNote}
          title={t("header.newNote")}
        >
          <Plus size={18} />
        </button>
        <button
          className="icon-btn"
          onClick={onOpenObsidian}
          title={t("header.openObsidian")}
        >
          <ExternalLink size={18} />
        </button>
      </div>
    </div>
  );
}
