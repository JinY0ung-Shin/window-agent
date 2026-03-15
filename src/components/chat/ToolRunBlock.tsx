import { useState } from "react";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader,
  Wrench,
  X,
} from "lucide-react";
import type { ChatMessage } from "../../services/types";
import { useToolRunStore } from "../../stores/toolRunStore";
import MessageBody from "./MessageBody";
import ToolResultDetail from "./ToolResultDetail";
import type { ToolRunStep } from "./chatRenderBlocks";
import {
  formatArgsSummary,
  getToolOutcomePreview,
  getToolStatusLabel,
  getToolStatusTone,
  getWriteFilePreview,
  type ToolCallStatus,
} from "./toolCallUtils";

interface ToolRunBlockProps {
  assistantMessage: ChatMessage;
  leadingContent?: string;
  steps: ToolRunStep[];
  isActiveRun: boolean;
}

function statusIcon(status: ToolCallStatus) {
  switch (status) {
    case "pending":
    case "approved":
    case "incomplete":
      return <Wrench size={14} />;
    case "running":
      return <Loader size={14} className="spinning" />;
    case "executed":
      return <Check size={14} />;
    case "denied":
      return <X size={14} />;
    case "error":
      return <AlertCircle size={14} />;
  }
}

function isStickyStatus(status: ToolCallStatus): boolean {
  return status === "pending"
    || status === "approved"
    || status === "running"
    || status === "denied"
    || status === "error"
    || status === "incomplete";
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
}: ToolRunBlockProps) {
  const toolRunState = useToolRunStore((state) => state.toolRunState);
  const approveToolCall = useToolRunStore((state) => state.approveToolCall);
  const rejectToolCall = useToolRunStore((state) => state.rejectToolCall);
  const hasOnlySuccessfulSteps = steps.every((step) => step.status === "executed");
  const [expanded, setExpanded] = useState(!hasOnlySuccessfulSteps);
  const [openSuccessfulStepId, setOpenSuccessfulStepId] = useState<string | null>(null);

  const hasPendingApprovals = isActiveRun
    && toolRunState === "tool_waiting"
    && steps.some((step) => step.status === "pending");

  return (
    <div className="message agent tool-run-message">
      <div className="avatar">
        <Bot size={22} color="#6366f1" />
      </div>
      <div className="bubble tool-run-bubble">
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
              <span className="tool-run-summary-title">도구 {steps.length}개 실행</span>
              <span className="tool-run-summary-meta">{summarizeStatuses(steps)}</span>
            </span>
            <span className="tool-run-summary-chevron">
              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          {hasPendingApprovals && (
            <div className="tool-call-actions tool-run-actions">
              <button type="button" className="tool-approve-btn" onClick={approveToolCall}>
                <Check size={14} /> 승인
              </button>
              <button type="button" className="tool-reject-btn" onClick={rejectToolCall}>
                <X size={14} /> 거부
              </button>
            </div>
          )}

          {expanded && (
            <div className="tool-run-steps">
              {steps.map((step) => {
                const argsSummary = formatArgsSummary(step.toolCall.arguments);
                const outcomePreview = getToolOutcomePreview(
                  step.toolCall,
                  step.resultMessage?.content,
                  step.status,
                );
                const stickyStatus = isStickyStatus(step.status);
                const writePreview = step.resultMessage
                  ? null
                  : step.toolCall.name === "write_file"
                    ? getWriteFilePreview(step.toolCall.arguments)
                    : null;
                const hasExpandableDetail = !!step.resultMessage || !!writePreview || !!argsSummary;
                const isDetailOpen = stickyStatus || openSuccessfulStepId === step.toolCall.id;

                return (
                  <div
                    key={step.toolCall.id}
                    className={`tool-run-step tool-status-${step.status} ${isDetailOpen ? "is-open" : ""}`}
                  >
                    <button
                      type="button"
                      className={`tool-run-step-header ${!hasExpandableDetail ? "is-static" : ""}`}
                      onClick={() => {
                        if (!hasExpandableDetail || stickyStatus) return;
                        setOpenSuccessfulStepId((current) => (
                          current === step.toolCall.id ? null : step.toolCall.id
                        ));
                      }}
                      aria-expanded={hasExpandableDetail ? isDetailOpen : undefined}
                    >
                      <span className="tool-run-step-icon">{statusIcon(step.status)}</span>
                      <span className="tool-run-step-copy">
                        <span className="tool-run-step-name">{step.toolCall.name}</span>
                        <span className="tool-run-step-preview">{outcomePreview}</span>
                      </span>
                      <span
                        className={`tool-call-status-badge tool-badge-${getToolStatusTone(step.status)}`}
                      >
                        {getToolStatusLabel(step.status)}
                      </span>
                      {hasExpandableDetail && !stickyStatus && (
                        <span className="tool-run-step-chevron">
                          {isDetailOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                        </span>
                      )}
                    </button>

                    {isDetailOpen && (
                      <div className="tool-run-step-detail">
                        {argsSummary && (
                          <div className="tool-run-step-args">{argsSummary}</div>
                        )}
                        {writePreview && (
                          <pre className="tool-call-preview">{writePreview}</pre>
                        )}
                        {step.resultMessage && (
                          <ToolResultDetail
                            toolName={step.toolCall.name}
                            result={step.resultMessage.content}
                            isError={step.status === "error"}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
