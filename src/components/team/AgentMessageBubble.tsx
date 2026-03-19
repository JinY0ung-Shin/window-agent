import { useTranslation } from "react-i18next";
import { Bot, User, Crown, AlertCircle } from "lucide-react";
import type { ChatMessage } from "../../services/types";
import MessageBody from "../chat/MessageBody";

interface Props {
  message: ChatMessage;
  isLeader?: boolean;
}

export default function AgentMessageBubble({ message, isLeader }: Props) {
  const { t } = useTranslation("team");
  const isUser = message.type === "user";
  const isPending = message.status === "pending";
  const isStreaming = message.status === "streaming";
  const isFailed = message.status === "failed";
  const isAborted = message.status === "aborted";

  if (isUser) {
    return (
      <div className="team-message team-message-user">
        <div className="team-msg-avatar team-msg-avatar-user">
          <User size={18} />
        </div>
        <div className="team-msg-bubble team-msg-bubble-user">
          <MessageBody content={message.content} />
        </div>
      </div>
    );
  }

  const agentName = message.senderAgentName ?? t("chat.unknownAgent");
  const agentAvatar = message.senderAgentAvatar;

  return (
    <div className={`team-message team-message-agent${isFailed ? " failed" : ""}${isAborted ? " aborted" : ""}`}>
      <div className="team-msg-avatar team-msg-avatar-agent">
        {agentAvatar ? (
          <img src={agentAvatar} alt="" className="team-msg-avatar-img" />
        ) : (
          <Bot size={18} color="#6366f1" />
        )}
      </div>
      <div className="team-msg-content">
        <div className="team-msg-header">
          <span className="team-msg-name">{agentName}</span>
          {isLeader && (
            <span className="team-role-badge team-role-leader">
              <Crown size={10} />
              {t("chat.leader")}
            </span>
          )}
          {!isLeader && message.senderAgentId && (
            <span className="team-role-badge team-role-member">
              {t("chat.member")}
            </span>
          )}
          {isStreaming && <span className="team-streaming-badge">{t("chat.streaming")}</span>}
        </div>
        <div className="team-msg-bubble team-msg-bubble-agent">
          {isPending ? (
            <span className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          ) : (
            <>
              <MessageBody
                content={message.content}
                reasoningContent={message.reasoningContent}
              />
              {isFailed && (
                <div className="team-msg-error">
                  <AlertCircle size={14} />
                  {t("chat.failed")}
                </div>
              )}
              {isAborted && (
                <div className="team-msg-aborted">{t("chat.aborted")}</div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
