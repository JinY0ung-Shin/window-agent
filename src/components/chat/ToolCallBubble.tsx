import { useState } from "react";
import { Wrench, Check, X, Loader, ChevronDown, ChevronRight, AlertCircle } from "lucide-react";
import type { ToolCall } from "../../services/types";

type ToolCallStatus = "pending" | "approved" | "running" | "executed" | "denied" | "error";

interface ToolCallBubbleProps {
  toolCall: ToolCall;
  status: ToolCallStatus;
  result?: string;
  onApprove?: () => void;
  onReject?: () => void;
}

function formatArgsSummary(args: string): string {
  try {
    const parsed = JSON.parse(args);
    return Object.entries(parsed)
      .map(([k, v]) => {
        const val = typeof v === "string" ? (v.length > 60 ? v.slice(0, 60) + "..." : v) : JSON.stringify(v);
        return `${k}: ${val}`;
      })
      .join(", ");
  } catch {
    return args.length > 80 ? args.slice(0, 80) + "..." : args;
  }
}

function getWriteFilePreview(args: string): string | null {
  try {
    const parsed = JSON.parse(args);
    if (typeof parsed.content === "string") {
      const lines = parsed.content.split("\n");
      return lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n..." : "");
    }
  } catch { /* ignore */ }
  return null;
}

export default function ToolCallBubble({ toolCall, status, result, onApprove, onReject }: ToolCallBubbleProps) {
  const [expanded, setExpanded] = useState(false);

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
    }
  };

  const statusLabel = () => {
    switch (status) {
      case "pending": return "승인 대기";
      case "approved": return "승인됨";
      case "running": return "실행 중...";
      case "executed": return "완료";
      case "denied": return "거부됨";
      case "error": return "오류";
    }
  };

  const writePreview = toolCall.name === "write_file" ? getWriteFilePreview(toolCall.arguments) : null;

  return (
    <div className={`tool-call-bubble tool-status-${status}`}>
      <div className="tool-call-header" onClick={() => (status === "executed" || status === "error") && setExpanded(!expanded)}>
        <span className="tool-call-icon">{statusIcon()}</span>
        <span className="tool-call-name">{toolCall.name}</span>
        <span className={`tool-call-status-badge tool-badge-${status}`}>{statusLabel()}</span>
        {(status === "executed" || status === "error") && result && (
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
            <Check size={14} /> 승인
          </button>
          <button className="tool-reject-btn" onClick={onReject}>
            <X size={14} /> 거부
          </button>
        </div>
      )}

      {expanded && result && (
        <pre className={`tool-call-result ${status === "error" ? "tool-result-error" : ""}`}>
          {result}
        </pre>
      )}
    </div>
  );
}
