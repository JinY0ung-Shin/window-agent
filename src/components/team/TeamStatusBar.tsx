import { useTranslation } from "react-i18next";
import { Bot, Check, Loader } from "lucide-react";
import { useTeamRunStore } from "../../stores/teamRunStore";
import { useAgentStore } from "../../stores/agentStore";
import { useMessageStore } from "../../stores/messageStore";

export default function TeamStatusBar() {
  const { t } = useTranslation("team");
  const activeRuns = useTeamRunStore((s) => s.activeRuns);
  const tasksByRun = useTeamRunStore((s) => s.tasksByRun);
  const agents = useAgentStore((s) => s.agents);
  const messages = useMessageStore((s) => s.messages);

  const runIds = Object.keys(activeRuns);
  if (runIds.length === 0) return null;

  const latestRunId = runIds[runIds.length - 1];
  const run = activeRuns[latestRunId];
  if (!run || run.status === "completed" || run.status === "cancelled") return null;

  const tasks = tasksByRun[latestRunId] ?? [];
  const completedTasks = tasks.filter((t) => t.status === "completed").length;

  // Find agents involved in this run from messages
  const runAgentIds = new Set<string>();
  for (const msg of messages) {
    if (msg.teamRunId === latestRunId && msg.senderAgentId) {
      runAgentIds.add(msg.senderAgentId);
    }
  }

  const agentStatuses = Array.from(runAgentIds).map((agentId) => {
    const agent = agents.find((a) => a.id === agentId);
    const agentMessages = messages.filter(
      (m) => m.teamRunId === latestRunId && m.senderAgentId === agentId,
    );
    const latestMsg = agentMessages[agentMessages.length - 1];
    const status: "idle" | "streaming" | "done" =
      latestMsg?.status === "streaming" || latestMsg?.status === "pending"
        ? "streaming"
        : latestMsg?.status === "complete"
          ? "done"
          : "idle";

    return {
      agentId,
      name: agent?.name ?? agentId,
      avatar: agent?.avatar ?? null,
      status,
    };
  });

  return (
    <div className="team-status-bar">
      <div className="team-status-agents">
        {agentStatuses.map((a) => (
          <div
            key={a.agentId}
            className={`team-status-agent team-status-${a.status}`}
            title={a.name}
          >
            {a.avatar ? (
              <img src={a.avatar} alt="" className="team-status-avatar" />
            ) : (
              <Bot size={14} />
            )}
            {a.status === "streaming" && <Loader size={10} className="team-status-spin" />}
            {a.status === "done" && <Check size={10} className="team-status-check" />}
          </div>
        ))}
      </div>
      {tasks.length > 0 && (
        <span className="team-status-progress">
          {t("chat.taskProgress", { done: completedTasks, total: tasks.length })}
        </span>
      )}
    </div>
  );
}
