import { useEffect } from "react";
import { useVaultStore } from "../../stores/vaultStore";
import GraphCanvas from "./GraphCanvas";

interface GraphPaneProps {
  onNodeClick: (noteId: string) => void;
}

const LEGEND_ITEMS = [
  { label: "지식", color: "#6366f1" },
  { label: "결정", color: "#f59e0b" },
  { label: "대화", color: "#10b981" },
  { label: "회고", color: "#8b5cf6" },
] as const;

export default function GraphPane({ onNodeClick }: GraphPaneProps) {
  const { graph, loadGraph, activeAgent } = useVaultStore();

  useEffect(() => {
    loadGraph(activeAgent ?? undefined, 2);
  }, [loadGraph, activeAgent]);

  if (!graph) {
    return (
      <div className="vault-graph-pane">
        <div className="vault-graph-empty">그래프를 로드하는 중...</div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="vault-graph-pane">
        <div className="vault-graph-empty">노트가 없습니다</div>
      </div>
    );
  }

  return (
    <div className="vault-graph-pane">
      <div className="vault-graph-stats">
        노드 {graph.nodes.length} · 엣지 {graph.edges.length}
      </div>
      <GraphCanvas data={graph} onNodeClick={onNodeClick} />
      <div className="vault-graph-legend">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="vault-graph-legend-item">
            <span
              className="vault-graph-legend-dot"
              style={{ background: item.color }}
            />
            {item.label}
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
          공유
        </div>
      </div>
    </div>
  );
}
