import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Wrench, Check, X, Loader, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import type { ToolCall } from "../../services/types";
import ToolResultDetail from "./ToolResultDetail";
import {
  formatArgsSummary,
  getToolStatusLabel,
  getWriteFilePreview,
  type ToolCallStatus,
} from "./toolCallUtils";

interface ToolCallBubbleProps {
  toolCall: ToolCall;
  status: ToolCallStatus;
  result?: string;
  onApprove?: () => void;
  onReject?: () => void;
}

export default function ToolCallBubble({ toolCall, status, result, onApprove, onReject }: ToolCallBubbleProps) {
  const { t } = useTranslation("chat");
  const [expanded, setExpanded] = useState(false);
  const canExpand = !!result && (status === "executed" || status === "error" || status === "denied");

  const statusIcon = () => {
    switch (status) {
      case "pending":
      case "approved":
        return <Wrench size={14} />;
      case "running":
        return <Loader size={14} className="spinning" />;
      case "executed":
        return <Check size={14} />;
      case "denied":
        return <X size={14} />;
      case "error":
        return <AlertCircle size={14} />;
      case "incomplete":
        return <Wrench size={14} />;
    }
  };

  const writePreview = toolCall.name === "write_file" ? getWriteFilePreview(toolCall.arguments) : null;

  return (
    <div className={`tool-call-bubble tool-status-${status}`}>
      <div className="tool-call-header" onClick={() => canExpand && setExpanded(!expanded)}>
        <span className="tool-call-icon">{statusIcon()}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className={`tool-call-status-badge tool-badge-${status === "incomplete" ? "approved" : status}`}>{getToolStatusLabel(status)}</span>
        {canExpand && (
          <span className="tool-call-expand">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </div>

      <div className="tool-call-args">{formatArgsSummary(toolCall.arguments)}</div>

      {writePreview && status === "pending" && (
        <pre className="tool-call-preview">{writePreview}</pre>
      )}

      {(status === "pending") && onApprove && onReject && (
        <div className="tool-call-actions">
          <button className="tool-approve-btn" onClick={onApprove}>
            <Check size={14} /> {t("tool.approve")}
          </button>
          <button className="tool-reject-btn" onClick={onReject}>
            <X size={14} /> {t("tool.reject")}
          </button>
        </div>
      )}

      {expanded && result && (
        <ToolResultDetail
          toolName={toolCall.name}
          result={result}
          isError={status === "error"}
        />
      )}
    </div>
  );
}
