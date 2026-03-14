import { useState } from "react";
import { Bot, User, Wrench, ChevronDown, ChevronRight, Copy, Check, RefreshCw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage as ChatMessageType } from "../../services/types";
import { useChatStore } from "../../stores/chatStore";
import ToolCallBubble from "./ToolCallBubble";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isPending = message.status === "pending";
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyMessage = useChatStore((s) => s.copyMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);
  const toolRunState = useChatStore((s) => s.toolRunState);
  const pendingToolCalls = useChatStore((s) => s.pendingToolCalls);
  const approveToolCall = useChatStore((s) => s.approveToolCall);
  const rejectToolCall = useChatStore((s) => s.rejectToolCall);

  const handleCopy = () => {
    copyMessage(message.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // Tool result message — render as tool bubble
  if (message.type === "tool") {
    const isError = message.content.startsWith("Error:") || message.content.startsWith("Tool denied") || message.content.startsWith("Tool call rejected");
    return (
      <div className="message agent">
        <div className="avatar tool-avatar">
          <Wrench size={18} color="#8b5cf6" />
        </div>
        <div className="bubble tool-result-bubble">
          <ToolCallBubble
            toolCall={{ id: message.tool_call_id ?? "", name: message.tool_name ?? "tool", arguments: "" }}
            status={isError ? "error" : "executed"}
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
            {message.reasoningContent && (
              <div className="reasoning-toggle" onClick={() => setShowReasoning(!showReasoning)}>
                {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>추론 과정</span>
              </div>
            )}
            {showReasoning && message.reasoningContent && (
              <div className="reasoning-content">{message.reasoningContent}</div>
            )}
            {message.content && (
              <div className="markdown-body">
                <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                  {message.content}
                </Markdown>
              </div>
            )}
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
                <button className="action-btn" onClick={handleCopy} title="복사">
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                </button>
                <button className="action-btn" onClick={() => regenerateMessage(message.id)} title="재생성">
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
