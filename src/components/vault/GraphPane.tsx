import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useVaultStore } from "../../stores/vaultStore";
import GraphCanvas from "./GraphCanvas";

interface GraphPaneProps {
  onNodeClick: (noteId: string) => void;
}

const LEGEND_KEYS = [
  { key: "knowledge", color: "#6366f1" },
  { key: "decision", color: "#f59e0b" },
  { key: "conversation", color: "#10b981" },
  { key: "reflection", color: "#8b5cf6" },
] as const;

export default function GraphPane({ onNodeClick }: GraphPaneProps) {
  const { t } = useTranslation("vault");
  const { graph, loadGraph, activeAgent } = useVaultStore();

  useEffect(() => {
    loadGraph(activeAgent ?? undefined, 2);
  }, [loadGraph, activeAgent]);

  if (!graph) {
    return (
      <div className="vault-graph-pane">
        <div className="vault-graph-empty">{t("graph.loading")}</div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="vault-graph-pane">
        <div className="vault-graph-empty">{t("graph.empty")}</div>
      </div>
    );
  }

  return (
    <div className="vault-graph-pane">
      <div className="vault-graph-stats">
        {t("graph.stats", { nodes: graph.nodes.length, edges: graph.edges.length })}
      </div>
      <GraphCanvas data={graph} onNodeClick={onNodeClick} />
      <div className="vault-graph-legend">
        {LEGEND_KEYS.map((item) => (
          <div key={item.key} className="vault-graph-legend-item">
            <span
              className="vault-graph-legend-dot"
              style={{ background: item.color }}
            />
            {t(`category.${item.key}`)}
          </div>
        ))}
        <div className="vault-graph-legend-item">
          <span
            className="vault-graph-legend-dot"
            style={{
              background: "transparent",
              border: "2px dashed var(--vault-shared-border)",
            }}
          />
          {t("graph.shared")}
        </div>
      </div>
    </div>
  );
}
