import { useRef, useEffect, useCallback } from "react";
import * as d3Force from "d3-force";
import * as d3Selection from "d3-selection";
import * as d3Zoom from "d3-zoom";
import * as d3Drag from "d3-drag";
import type { GraphData, GraphNode, GraphEdge } from "../../services/vaultTypes";

interface GraphCanvasProps {
  data: GraphData;
  onNodeClick: (nodeId: string) => void;
}

interface SimNode extends d3Force.SimulationNodeDatum {
  id: string;
  label: string;
  agent: string;
  noteType: string;
  tags: string[];
  confidence: number;
  updatedAt: string;
}

interface SimLink extends d3Force.SimulationLinkDatum<SimNode> {
  edgeType: string;
}

const NODE_COLORS: Record<string, string> = {
  knowledge: "#6366f1",
  decision: "#f59e0b",
  conversation: "#10b981",
  reflection: "#8b5cf6",
};

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function nodeRadius(confidence: number): number {
  return 8 + confidence * 12;
}

export default function GraphCanvas({ data, onNodeClick }: GraphCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3Force.Simulation<SimNode, SimLink> | null>(null);

  const onNodeClickRef = useRef(onNodeClick);
  onNodeClickRef.current = onNodeClick;

  const buildGraph = useCallback(() => {
    const svg = svgRef.current;
    const container = containerRef.current;
    if (!svg || !container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;

    // Clear previous
    const sel = d3Selection.select(svg);
    sel.selectAll("*").remove();

    // Prepare data (deep copy for D3 mutation)
    const nodes: SimNode[] = data.nodes.map((n: GraphNode) => ({ ...n }));
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));
    const links: SimLink[] = data.edges
      .filter((e: GraphEdge) => nodeMap.has(e.source) && nodeMap.has(e.target))
      .map((e: GraphEdge) => ({
        source: e.source,
        target: e.target,
        edgeType: e.edgeType,
      }));

    // SVG setup
    sel.attr("width", width).attr("height", height);

    // Arrow marker
    sel
      .append("defs")
      .append("marker")
      .attr("id", "vault-arrow")
      .attr("viewBox", "0 -3 6 6")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-3L6,0L0,3")
      .attr("fill", "var(--border)");

    // Main group for zoom/pan
    const g = sel.append("g");

    // Zoom behavior
    const zoomBehavior = d3Zoom
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 4])
      .on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
    sel.call(zoomBehavior);

    // Edge group
    const linkGroup = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#vault-arrow)");

    // Node group
    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll<SVGGElement, SimNode>("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer")
      .on("click", (_event, d) => {
        onNodeClickRef.current(d.id);
      });

    // Node circles
    nodeGroup
      .append("circle")
      .attr("r", (d) => nodeRadius(d.confidence))
      .attr("fill", (d) => NODE_COLORS[d.noteType] ?? "#94a3b8")
      .attr("stroke", "var(--border)")
      .attr("stroke-width", 2)
      .attr("stroke-dasharray", (d) => (d.agent === "shared" ? "4 2" : "none"));

    // Labels
    nodeGroup
      .append("text")
      .text((d) => truncate(d.label, 15))
      .attr("text-anchor", "middle")
      .attr("dy", (d) => nodeRadius(d.confidence) + 14)
      .attr("font-size", "0.6875rem")
      .attr("fill", "var(--text-muted)")
      .attr("pointer-events", "none");

    // Hover: full title tooltip + enlarge
    nodeGroup
      .on("mouseenter", function (_event, d) {
        const el = d3Selection.select<SVGGElement, SimNode>(this);
        el.select("circle").attr("r", nodeRadius(d.confidence) * 1.3);
        el.select("text").text(d.label);

        // Highlight connected edges
        linkGroup
          .attr("stroke", (l: SimLink) => {
            const src = typeof l.source === "object" ? (l.source as SimNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target;
            return src === d.id || tgt === d.id ? NODE_COLORS[d.noteType] ?? "#94a3b8" : "var(--border)";
          })
          .attr("stroke-width", (l: SimLink) => {
            const src = typeof l.source === "object" ? (l.source as SimNode).id : l.source;
            const tgt = typeof l.target === "object" ? (l.target as SimNode).id : l.target;
            return src === d.id || tgt === d.id ? 2.5 : 1.5;
          });
      })
      .on("mouseleave", function (_event, d) {
        const el = d3Selection.select<SVGGElement, SimNode>(this);
        el.select("circle").attr("r", nodeRadius(d.confidence));
        el.select("text").text(truncate(d.label, 15));

        linkGroup.attr("stroke", "var(--border)").attr("stroke-width", 1.5);
      });

    // Drag behavior
    const dragBehavior = d3Drag
      .drag<SVGGElement, SimNode>()
      .on("start", (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on("drag", (_event, d) => {
        d.fx = _event.x;
        d.fy = _event.y;
      })
      .on("end", (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });
    nodeGroup.call(dragBehavior);

    // Force simulation
    const simulation = d3Force
      .forceSimulation<SimNode>(nodes)
      .force(
        "link",
        d3Force
          .forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance(80),
      )
      .force("charge", d3Force.forceManyBody().strength(-200))
      .force("center", d3Force.forceCenter(width / 2, height / 2))
      .force("collide", d3Force.forceCollide(20))
      .on("tick", () => {
        linkGroup
          .attr("x1", (d: SimLink) => (d.source as SimNode).x!)
          .attr("y1", (d: SimLink) => (d.source as SimNode).y!)
          .attr("x2", (d: SimLink) => (d.target as SimNode).x!)
          .attr("y2", (d: SimLink) => (d.target as SimNode).y!);

        nodeGroup.attr("transform", (d) => `translate(${d.x},${d.y})`);
      });

    simulationRef.current = simulation;
  }, [data]);

  // Build graph on data change
  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  // ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      buildGraph();
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      simulationRef.current?.stop();
    };
  }, [buildGraph]);

  return (
    <div ref={containerRef} className="vault-graph-canvas">
      <svg ref={svgRef} />
    </div>
  );
}
