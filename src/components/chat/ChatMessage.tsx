import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, User, Wrench, Copy, Check, RefreshCw } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../../services/types";
import { useMessageStore } from "../../stores/messageStore";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import ToolCallBubble from "./ToolCallBubble";
import MessageBody from "./MessageBody";
import { classifyToolResultStatus } from "./toolCallUtils";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const { t } = useTranslation("chat");
  const isPending = message.status === "pending";
  const [copied, setCopied] = useState(false);
  const copyMessage = useMessageStore((s) => s.copyMessage);
  const regenerateMessage = useChatFlowStore((s) => s.regenerateMessage);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const pendingToolCalls = useToolRunStore((s) => s.pendingToolCalls);
  const approveToolCall = useToolRunStore((s) => s.approveToolCall);
  const rejectToolCall = useToolRunStore((s) => s.rejectToolCall);

  const handleCopy = () => {
    copyMessage(message.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Tool result message — render as tool bubble
  if (message.type === "tool") {
    return (
      <div className="message agent">
        <div className="avatar tool-avatar">
          <Wrench size={18} color="#8b5cf6" />
        </div>
        <div className="bubble tool-result-bubble">
          <ToolCallBubble
            toolCall={{ id: message.tool_call_id ?? "", name: message.tool_name ?? "tool", arguments: "" }}
            status={classifyToolResultStatus(message.content)}
            result={message.content}
          />
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

  return (
    <div className={`message ${message.type} ${isPending ? "loading" : ""} ${message.status === "failed" ? "failed" : ""}`}>
      <div className="avatar">
        {message.type === "agent" ? (
          <Bot size={22} color="#6366f1" />
        ) : (
          <User size={22} />
        )}
      </div>
      <div className="bubble">
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
            {message.type === "agent" && message.status === "complete" && !hasToolCalls && (
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
  );
}
