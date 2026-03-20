import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, X, ChevronDown, ChevronUp, FileEdit } from "lucide-react";
import { p2pRequestDraft } from "../../services/commands/p2pCommands";
import { logger } from "../../services/logger";

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
  const { t } = useTranslation("network");
  const [showOriginal, setShowOriginal] = useState(false);
  const [responseText, setResponseText] = useState(t("approval.defaultResponse"));
  const [isDraftLoading, setIsDraftLoading] = useState(false);

  const handleRequestDraft = async () => {
    if (!agentId) return;
    setIsDraftLoading(true);
    try {
      const draft = await p2pRequestDraft(messageId, agentId);
      setResponseText(draft);
    } catch (e) {
      logger.debug("Draft request failed, keeping current text", e);
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
        {showOriginal ? t("approval.hideOriginal") : t("approval.showOriginal")}
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
        placeholder={t("approval.responsePlaceholder")}
      />

      <div className="approval-actions">
        {agentId && (
          <button
            className="approval-btn draft"
            onClick={handleRequestDraft}
            disabled={isDraftLoading}
          >
            <FileEdit size={14} />
            {isDraftLoading ? t("approval.drafting") : t("approval.requestDraft")}
          </button>
        )}
        <button className="approval-btn approve" onClick={() => onApprove(responseText)}>
          <Check size={14} />
          {t("approval.approveAndSend")}
        </button>
        <button className="approval-btn reject" onClick={onReject}>
          <X size={14} />
          {t("approval.reject")}
        </button>
      </div>
    </div>
  );
}
