import { useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader,
  Wrench,
  X,
} from "lucide-react";
import type { ToolRunStep } from "./chatRenderBlocks";
import ToolResultDetail from "./ToolResultDetail";
import {
  formatArgsSummary,
  getToolOutcomePreview,
  getToolStatusLabel,
  getToolStatusTone,
  getWriteFilePreview,
  type ToolCallStatus,
} from "./toolCallUtils";

export function statusIcon(status: ToolCallStatus) {
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

export function isStickyStatus(status: ToolCallStatus): boolean {
  return status === "pending"
    || status === "approved"
    || status === "running"
    || status === "denied"
    || status === "error"
    || status === "incomplete";
}

interface ToolRunStepListProps {
  steps: ToolRunStep[];
}

export default function ToolRunStepList({ steps }: ToolRunStepListProps) {
  const [openStepId, setOpenStepId] = useState<string | null>(null);

  return (
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
        const isDetailOpen = stickyStatus || openStepId === step.toolCall.id;

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
                setOpenStepId((current) => (
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
  );
}
