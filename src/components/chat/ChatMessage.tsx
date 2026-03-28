import { useTranslation } from "react-i18next";
import { AlertCircle, Bot, User, Wrench, Copy, Check, RefreshCw, Crown } from "lucide-react";
import { useClipboardFeedback } from "../../hooks/useClipboardFeedback";
import type { ChatMessage as ChatMessageType } from "../../services/types";
import type { SenderInfo } from "./ToolRunBlock";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import ToolCallBubble from "./ToolCallBubble";
import MessageBody from "./MessageBody";
import OnboardingAnimation from "./OnboardingAnimation";
import { classifyToolResultStatus } from "./toolCallUtils";

interface Props {
  message: ChatMessageType;
  senderInfo?: SenderInfo;
}

export default function ChatMessage({ message, senderInfo }: Props) {
  const { t } = useTranslation("chat");
  const { t: tTeam } = useTranslation("team");
  const isPending = message.status === "pending";
  const isOnboarding = useBootstrapStore((s) => s.isOnboarding);
  const { copied, copy } = useClipboardFeedback(1500);
  const regenerateMessage = useChatFlowStore((s) => s.regenerateMessage);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const pendingToolCalls = useToolRunStore((s) => s.pendingToolCalls);
  const approveToolCall = useToolRunStore((s) => s.approveToolCall);
  const rejectToolCall = useToolRunStore((s) => s.rejectToolCall);

  const handleCopy = () => {
    copy(message.content);
  };

  // Tool result message — render as tool bubble
  if (message.type === "tool") {
    return (
      <div className={`message agent${senderInfo ? " team-message team-message-agent" : ""}`}>
        <div className={senderInfo ? "team-msg-avatar team-msg-avatar-agent" : "avatar tool-avatar"}>
          {senderInfo?.agentAvatar ? (
            <img src={senderInfo.agentAvatar} alt={senderInfo.agentName || tTeam("chat.unknownAgent")} className="team-msg-avatar-img" />
          ) : senderInfo ? (
            <Bot size={18} color="#6366f1" />
          ) : (
            <Wrench size={18} color="#8b5cf6" />
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
          <div className={senderInfo ? "team-msg-bubble team-msg-bubble-agent" : "bubble tool-result-bubble"}>
            <ToolCallBubble
              toolCall={{ id: message.tool_call_id ?? "", name: message.tool_name ?? "tool", arguments: "" }}
              status={classifyToolResultStatus(message.content)}
              result={message.content}
            />
          </div>
        </div>
      </div>
    );
  }

  // Agent message with tool_calls — render content + tool call bubbles
  const hasToolCalls = message.type === "agent" && message.tool_calls && message.tool_calls.length > 0;

  // Determine if these tool calls are the currently pending ones
  const isCurrentPending = hasToolCalls && (toolRunState === "tool_waiting" || toolRunState === "tool_pending")
    && pendingToolCalls.length > 0
    && message.tool_calls!.some((tc) => pendingToolCalls.find((p) => p.id === tc.id));

  const getToolCallStatus = (tcId: string) => {
    if (isCurrentPending) {
      if (toolRunState === "tool_waiting") return "pending" as const;
      if (toolRunState === "tool_pending") return "approved" as const;
    }
    if (toolRunState === "tool_running" && pendingToolCalls.find((p) => p.id === tcId)) {
      return "running" as const;
    }
    return "executed" as const;
  };

  // User messages always render the same way (no senderInfo)
  if (message.type === "user") {
    return (
      <div className={`message user ${isPending ? "loading" : ""} ${message.status === "failed" ? "failed" : ""}${senderInfo ? " team-message team-message-user" : ""}`}>
        <div className={senderInfo ? "team-msg-avatar team-msg-avatar-user" : "avatar"}>
          <User size={senderInfo ? 18 : 22} />
        </div>
        <div className={senderInfo ? "team-msg-bubble team-msg-bubble-user" : "bubble"}>
          {isPending ? (
            <span className="loading-dots">
              <span></span>
              <span></span>
              <span></span>
            </span>
          ) : (
            <MessageBody content={message.content} />
          )}
        </div>
      </div>
    );
  }

  // Agent message — with optional senderInfo for team context
  const isTeam = !!senderInfo;

  return (
    <div className={`message agent ${isPending && !isOnboarding ? "loading" : ""} ${message.status === "failed" ? "failed" : ""} ${message.status === "streaming" ? "streaming" : ""} ${message.status === "aborted" ? "aborted" : ""}${isTeam ? " team-message team-message-agent" : ""}`}>
      <div className={isTeam ? "team-msg-avatar team-msg-avatar-agent" : "avatar"}>
        {senderInfo?.agentAvatar ? (
          <img src={senderInfo.agentAvatar} alt={senderInfo.agentName || tTeam("chat.unknownAgent")} className="team-msg-avatar-img" />
        ) : (
          <Bot size={isTeam ? 18 : 22} color="#6366f1" />
        )}
      </div>
      <div className={isTeam ? "team-msg-content" : ""}>
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
            {message.status === "streaming" && <span className="team-streaming-badge">{tTeam("chat.streaming")}</span>}
          </div>
        )}
        <div className={isTeam ? "team-msg-bubble team-msg-bubble-agent" : "bubble"}>
          {isPending ? (
            isOnboarding ? (
              <OnboardingAnimation />
            ) : (
              <span className="loading-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>
            )
          ) : (
            <>
              <MessageBody
                content={message.content}
                reasoningContent={message.reasoningContent}
              />
              {hasToolCalls && (
                <div className="tool-calls-list">
                  {message.tool_calls!.map((tc) => (
                    <ToolCallBubble
                      key={tc.id}
                      toolCall={tc}
                      status={getToolCallStatus(tc.id)}
                      onApprove={isCurrentPending && toolRunState === "tool_waiting" ? approveToolCall : undefined}
                      onReject={isCurrentPending && toolRunState === "tool_waiting" ? rejectToolCall : undefined}
                    />
                  ))}
                </div>
              )}
              {isTeam && message.status === "failed" && (
                <div className="team-msg-error">
                  <AlertCircle size={14} />
                  {tTeam("chat.failed")}
                </div>
              )}
              {isTeam && message.status === "aborted" && (
                <div className="team-msg-aborted">{tTeam("chat.aborted")}</div>
              )}
              {!isTeam && message.status === "complete" && !hasToolCalls && (
                <div className="message-actions">
                  <button className="action-btn" onClick={handleCopy} title={t("message.copyTitle")}>
                    {copied ? <Check size={14} /> : <Copy size={14} />}
                  </button>
                  <button className="action-btn" onClick={() => regenerateMessage(message.id)} title={t("message.regenerateTitle")}>
                    <RefreshCw size={14} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
