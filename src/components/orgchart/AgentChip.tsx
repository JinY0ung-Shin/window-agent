import { useDraggable } from "@dnd-kit/core";
import type { Agent } from "../../services/types";

interface AgentChipProps {
  agent: Agent;
}

export function AgentChip({ agent }: AgentChipProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: agent.id });

  const style = {
    transform: transform
      ? `translate(${transform.x}px, ${transform.y}px)`
      : undefined,
    opacity: isDragging ? 0.5 : 1,
  };

  const statusColor =
    agent.onLeave
      ? "bg-yellow-400"
      : agent.status === "online"
        ? "bg-green-400"
        : agent.status === "busy"
          ? "bg-amber-400"
          : "bg-gray-500";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg cursor-grab active:cursor-grabbing transition-all ${
        agent.onLeave
          ? "bg-yellow-500/10 border border-yellow-500/20"
          : "bg-surface-700/40 hover:bg-surface-700/60"
      }`}
    >
      <span className="text-sm">{agent.avatar || "🤖"}</span>
      <span className="text-xs text-text-primary">{agent.name}</span>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor}`} />
      {agent.onLeave && (
        <span className="text-[10px] text-yellow-400 ml-0.5">휴직</span>
      )}
    </div>
  );
}
