import { useState } from "react";
import { Bot, User, ChevronDown, ChevronRight, Copy, Check, RefreshCw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { ChatMessage as ChatMessageType } from "../../services/types";
import { useChatStore } from "../../stores/chatStore";

interface Props {
  message: ChatMessageType;
}

export default function ChatMessage({ message }: Props) {
  const isPending = message.status === "pending";
  const [showReasoning, setShowReasoning] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyMessage = useChatStore((s) => s.copyMessage);
  const regenerateMessage = useChatStore((s) => s.regenerateMessage);

  const handleCopy = () => {
    copyMessage(message.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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
            <div className="markdown-body">
              <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {message.content}
              </Markdown>
            </div>
            {message.type === "agent" && message.status === "complete" && (
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
