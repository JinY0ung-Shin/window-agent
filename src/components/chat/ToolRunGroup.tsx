import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Crown,
  Wrench,
} from "lucide-react";
import type { ToolRunGroupRun } from "./chatRenderBlocks";
import type { SenderInfo } from "./ToolRunBlock";
import MessageBody from "./MessageBody";
import ToolRunStepList from "./ToolRunStepList";
import {
  getToolStatusLabel,
  type ToolCallStatus,
} from "./toolCallUtils";

interface ToolRunGroupProps {
  runs: ToolRunGroupRun[];
  senderInfo?: SenderInfo;
}

function summarizeAllStatuses(runs: ToolRunGroupRun[]): string {
  const counts = new Map<ToolCallStatus, number>();
  for (const run of runs) {
    for (const step of run.steps) {
      counts.set(step.status, (counts.get(step.status) ?? 0) + 1);
    }
  }

  const orderedStatuses: ToolCallStatus[] = [
    "error", "denied", "pending", "approved", "running", "executed", "incomplete",
  ];

  return orderedStatuses
    .map((status) => {
      const count = counts.get(status);
      if (!count) return null;
      return `${getToolStatusLabel(status)} ${count}`;
    })
    .filter(Boolean)
    .join(" \u00b7 ");
}

export default function ToolRunGroup({ runs, senderInfo }: ToolRunGroupProps) {
  const { t } = useTranslation("chat");
  const { t: tTeam } = useTranslation("team");
  const [expanded, setExpanded] = useState(false);
  const [expandedRoundIndex, setExpandedRoundIndex] = useState<number | null>(null);

  const totalSteps = runs.reduce((sum, r) => sum + r.steps.length, 0);
  const statusSummary = summarizeAllStatuses(runs);

  return (
    <div className={`message agent tool-run-message${senderInfo ? " team-message team-message-agent" : ""}`}>
      <div className={senderInfo ? "team-msg-avatar team-msg-avatar-agent" : "avatar"}>
        {senderInfo?.agentAvatar ? (
          <img src={senderInfo.agentAvatar} alt={senderInfo.agentName || tTeam("chat.unknownAgent")} className="team-msg-avatar-img" />
        ) : (
          <Bot size={senderInfo ? 18 : 22} color="#6366f1" />
        )}
      </div>
      <div className={senderInfo ? "team-msg-content" : ""}>
        {senderInfo && (
          <div className="team-msg-header">
            <span className="team-msg-name">{senderInfo.agentName || tTeam("chat.unknownAgent")}</span>
            {senderInfo.isLeader && (
              <span className="team-role-badge team-role-leader">
                <Crown size={10} />
                {tTeam("chat.leader")}
              </span>
            )}
            {!senderInfo.isLeader && senderInfo.agentName && (
              <span className="team-role-badge team-role-member">
                {tTeam("chat.member")}
              </span>
            )}
          </div>
        )}
        <div className={senderInfo ? "team-msg-bubble team-msg-bubble-agent" : "bubble tool-run-bubble"}>
          <section className={`tool-run-group ${expanded ? "is-expanded" : "is-collapsed"}`}>
            <button
              type="button"
              className="tool-run-summary"
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              <span className="tool-run-summary-icon">
                <Wrench size={15} />
              </span>
              <span className="tool-run-summary-copy">
                <span className="tool-run-summary-title">
                  {t("tool.groupSummary", { rounds: runs.length, count: totalSteps })}
                </span>
                <span className="tool-run-summary-meta">{statusSummary}</span>
              </span>
              <span className="tool-run-summary-chevron">
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
            </button>

            {expanded && (
              <div className="tool-run-group-rounds">
                {runs.map((run, roundIndex) => {
                  const isRoundExpanded = expandedRoundIndex === roundIndex;
                  const roundToolNames = run.steps
                    .map((s) => s.toolCall.name)
                    .join(", ");

                  return (
                    <div key={roundIndex} className="tool-run-group-round">
                      {(run.leadingContent || run.assistantMessage.reasoningContent) && (
                        <div className="tool-run-group-round-content">
                          <MessageBody
                            content={run.leadingContent}
                            reasoningContent={run.assistantMessage.reasoningContent}
                          />
                        </div>
                      )}
                      <button
                        type="button"
                        className="tool-run-group-round-header"
                        onClick={() =>
                          setExpandedRoundIndex(isRoundExpanded ? null : roundIndex)
                        }
                        aria-expanded={isRoundExpanded}
                      >
                        <span className="tool-run-group-round-icon">
                          <Wrench size={13} />
                        </span>
                        <span className="tool-run-group-round-copy">
                          <span className="tool-run-group-round-tools">
                            {roundToolNames}
                          </span>
                        </span>
                        <span className="tool-run-group-round-count">
                          {t("tool.runSummary", { count: run.steps.length })}
                        </span>
                        <span className="tool-run-step-chevron">
                          {isRoundExpanded ? (
                            <ChevronDown size={13} />
                          ) : (
                            <ChevronRight size={13} />
                          )}
                        </span>
                      </button>

                      {isRoundExpanded && <ToolRunStepList steps={run.steps} />}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
