import { useState } from "react";
import { Check, X, ChevronDown, ChevronUp, FileEdit } from "lucide-react";
import { p2pRequestDraft } from "../../services/commands/p2pCommands";

interface ApprovalPanelProps {
  messageId: string;
  summary: string;
  originalContent: string;
  agentId?: string;
  onApprove: (responseText: string) => void;
  onReject: () => void;
}

export default function ApprovalPanel({
  messageId,
  summary,
  originalContent,
  agentId,
  onApprove,
  onReject,
}: ApprovalPanelProps) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [responseText, setResponseText] = useState("감사합니다. 확인했습니다.");
  const [isDraftLoading, setIsDraftLoading] = useState(false);

  const handleRequestDraft = async () => {
    if (!agentId) return;
    setIsDraftLoading(true);
    try {
      const draft = await p2pRequestDraft(messageId, agentId);
      setResponseText(draft);
    } catch {
      // Keep current text on error
    } finally {
      setIsDraftLoading(false);
    }
  };

  return (
    <div className="approval-panel">
      <div className="approval-summary">
        {summary || originalContent.slice(0, 120) + (originalContent.length > 120 ? "..." : "")}
      </div>

      <button
        className="approval-toggle-btn"
        onClick={() => setShowOriginal((v) => !v)}
      >
        {showOriginal ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        {showOriginal ? "원문 접기" : "원문 보기"}
      </button>

      {showOriginal && (
        <div className="approval-original">
          {originalContent}
        </div>
      )}

      <textarea
        className="approval-response"
        value={responseText}
        onChange={(e) => setResponseText(e.target.value)}
        rows={3}
        placeholder="응답 내용을 입력하세요..."
      />

      <div className="approval-actions">
        {agentId && (
          <button
            className="approval-btn draft"
            onClick={handleRequestDraft}
            disabled={isDraftLoading}
          >
            <FileEdit size={14} />
            {isDraftLoading ? "생성 중..." : "초안 요청"}
          </button>
        )}
        <button className="approval-btn approve" onClick={() => onApprove(responseText)}>
          <Check size={14} />
          승인 &amp; 전송
        </button>
        <button className="approval-btn reject" onClick={onReject}>
          <X size={14} />
          거절
        </button>
      </div>
    </div>
  );
}
