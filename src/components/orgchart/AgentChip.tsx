import { useDraggable } from "@dnd-kit/core";
import type { Agent } from "../../services/types";
import { AvatarBadge } from "../ui/AvatarBadge";

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
      className={`inline-flex cursor-grab items-center gap-2 rounded-lg px-2.5 py-1.5 transition-all active:cursor-grabbing ${
        agent.onLeave
          ? "border border-yellow-500/20 bg-yellow-500/10"
          : "bg-surface-700/45 hover:bg-surface-700/65"
      }`}
    >
      <AvatarBadge name={agent.name} avatar={agent.avatar} size="sm" />
      <span className="text-xs text-text-primary">{agent.name}</span>
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${statusColor}`} />
      {agent.onLeave && <span className="ml-0.5 text-[10px] text-yellow-400">휴직</span>}
    </div>
  );
}
