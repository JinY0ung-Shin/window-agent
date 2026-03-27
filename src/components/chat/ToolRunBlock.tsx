import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Crown,
  Wrench,
  X,
} from "lucide-react";
import type { ChatMessage } from "../../services/types";
import { useToolRunStore } from "../../stores/toolRunStore";
import MessageBody from "./MessageBody";
import ToolRunStepList from "./ToolRunStepList";
import type { ToolRunStep } from "./chatRenderBlocks";
import {
  getToolStatusLabel,
  type ToolCallStatus,
} from "./toolCallUtils";

export interface SenderInfo {
  agentName?: string;
  agentAvatar?: string | null;
  isLeader?: boolean;
}

interface ToolRunBlockProps {
  assistantMessage: ChatMessage;
  leadingContent?: string;
  steps: ToolRunStep[];
  isActiveRun: boolean;
  senderInfo?: SenderInfo;
  /** 팀 실행 시 per-run 상태 조회 및 approve/reject 스코핑용 */
  runId?: string;
}

function summarizeStatuses(steps: ToolRunStep[]): string {
  const counts = new Map<ToolCallStatus, number>();
  for (const step of steps) {
    counts.set(step.status, (counts.get(step.status) ?? 0) + 1);
  }

  const orderedStatuses: ToolCallStatus[] = [
    "error",
    "denied",
    "pending",
    "approved",
    "running",
    "executed",
    "incomplete",
  ];

  return orderedStatuses
    .map((status) => {
      const count = counts.get(status);
      if (!count) return null;
      return `${getToolStatusLabel(status)} ${count}`;
    })
    .filter(Boolean)
    .join(" · ");
}

export default function ToolRunBlock({
  assistantMessage,
  leadingContent,
  steps,
  isActiveRun,
  senderInfo,
  runId,
}: ToolRunBlockProps) {
  const { t } = useTranslation("chat");
  const { t: tTeam } = useTranslation("team");
  const toolRunState = useToolRunStore((state) =>
    runId ? (state.toolRunStates[runId] ?? "idle") : state.toolRunState,
  );
  const approveToolCall = useToolRunStore((state) => state.approveToolCall);
  const rejectToolCall = useToolRunStore((state) => state.rejectToolCall);
  const hasOnlySuccessfulSteps = steps.every((step) => step.status === "executed");
  const [expanded, setExpanded] = useState(!hasOnlySuccessfulSteps);

  const hasPendingApprovals = isActiveRun
    && toolRunState === "tool_waiting"
    && steps.some((step) => step.status === "pending");

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
        {(assistantMessage.reasoningContent || leadingContent) && (
          <div className="tool-run-leading">
            <MessageBody
              content={leadingContent}
              reasoningContent={assistantMessage.reasoningContent}
            />
          </div>
        )}

        <section className={`tool-run-block ${expanded ? "is-expanded" : "is-collapsed"}`}>
          <button
            type="button"
            className="tool-run-summary"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
          >
            <span className="tool-run-summary-icon">
              <Wrench size={15} />
            </span>
            <span className="tool-run-summary-copy">
              <span className="tool-run-summary-title">{t("tool.runSummary", { count: steps.length })}</span>
              <span className="tool-run-summary-meta">{summarizeStatuses(steps)}</span>
            </span>
            <span className="tool-run-summary-chevron">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {hasPendingApprovals && (
            <div className="tool-call-actions tool-run-actions">
              <button type="button" className="tool-approve-btn" onClick={() => approveToolCall(runId)}>
                <Check size={14} /> {t("tool.approve")}
              </button>
              <button type="button" className="tool-reject-btn" onClick={() => rejectToolCall(runId)}>
                <X size={14} /> {t("tool.reject")}
              </button>
            </div>
          )}

          {expanded && <ToolRunStepList steps={steps} />}
        </section>
        </div>
      </div>
    </div>
  );
}
