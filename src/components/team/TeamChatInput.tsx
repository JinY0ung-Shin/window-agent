import { useTranslation } from "react-i18next";
import { Send, Square } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useTeamChatFlowStore } from "../../stores/teamChatFlowStore";
import { useTeamRunStore } from "../../stores/teamRunStore";
import TeamStatusBar from "./TeamStatusBar";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";

export default function TeamChatInput() {
  const { t } = useTranslation("team");
  const sendTeamMessage = useTeamChatFlowStore((s) => s.sendTeamMessage);
  const abortCurrentRun = useTeamChatFlowStore((s) => s.abortCurrentRun);
  const activeRuns = useTeamRunStore((s) => s.activeRuns);
  const messages = useMessageStore((s) => s.messages);

  const hasActiveRun = Object.values(activeRuns).some(
    (r) => r.status === "running" || r.status === "waiting_reports",
  );
  const isSending = messages.some(
    (m) => m.status === "pending" || m.status === "streaming",
  );
  const isBusy = hasActiveRun || isSending;

  const { textareaProps, localValue, flushAndSend } = useChatInputLogic({
    sendFn: sendTeamMessage,
    disabled: isBusy,
  });

  return (
    <div className="input-area">
      <TeamStatusBar />
      <div className="input-container">
        <textarea
          {...textareaProps}
          className="chat-input"
          placeholder={
            isBusy ? t("chat.inputBusy") : t("chat.inputPlaceholder")
          }
        />
        {isBusy ? (
          <button
            className="send-button cancel"
            onClick={abortCurrentRun}
            title={t("chat.abortTitle")}
          >
            <Square size={18} />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={flushAndSend}
            disabled={!localValue.trim()}
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
