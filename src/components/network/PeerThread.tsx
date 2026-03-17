import React, { useState, useRef, useEffect, useCallback } from "react";
import { Send, ArrowLeft } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import type { PeerMessageRow } from "../../services/commands/p2pCommands";
import DeliveryBadge from "./DeliveryBadge";
import ApprovalPanel from "./ApprovalPanel";

function PeerMessageBubble({ msg }: { msg: PeerMessageRow }) {
  const approveMessage = useNetworkStore((s) => s.approveMessage);
  const rejectMessage = useNetworkStore((s) => s.rejectMessage);
  const approvalSummaries = useNetworkStore((s) => s.approvalSummaries);
  const isOutgoing = msg.direction === "outgoing";
  const isPending = msg.approval_state === "pending" && !isOutgoing;

  const time = (() => {
    try {
      const d = new Date(msg.created_at);
      return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
    } catch {
      return "";
    }
  })();

  return (
    <div className={`peer-msg ${isOutgoing ? "outgoing" : "incoming"}`}>
      <div className="peer-msg-bubble">
        <div className="peer-msg-content">{msg.content}</div>
        <div className="peer-msg-meta">
          <span className="peer-msg-time">{time}</span>
          {isOutgoing && (
            <DeliveryBadge state={msg.delivery_state} />
          )}
        </div>
      </div>
      {isPending && (
        <ApprovalPanel
          messageId={msg.id}
          summary={approvalSummaries[msg.id] || ""}
          originalContent={msg.content}
          agentId={msg.sender_agent}
          onApprove={(responseText) => approveMessage(msg.id, responseText)}
          onReject={() => rejectMessage(msg.id)}
        />
      )}
      {!isOutgoing && msg.approval_state === "approved" && (
        <span className="peer-msg-approval approved">✓ 승인됨</span>
      )}
      {!isOutgoing && msg.approval_state === "rejected" && (
        <span className="peer-msg-approval rejected">✗ 거절됨</span>
      )}
    </div>
  );
}

export default function PeerThread() {
  const messages = useNetworkStore((s) => s.messages);
  const selectedThreadId = useNetworkStore((s) => s.selectedThreadId);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const sendMessage = useNetworkStore((s) => s.sendMessage);
  const selectThread = useNetworkStore((s) => s.selectThread);

  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposing = useRef(false);
  const shouldAutoScrollRef = useRef(true);

  const connectedPeers = useNetworkStore((s) => s.connectedPeers);
  const contact = contacts.find((c) => c.id === selectedContactId);
  const isOnline = contact ? connectedPeers.has(contact.peer_id) : false;

  const isNearBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < -2) shouldAutoScrollRef.current = false;
      else if (e.deltaY > 2 && isNearBottom()) shouldAutoScrollRef.current = true;
    };
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [isNearBottom]);

  useEffect(() => {
    if (shouldAutoScrollRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    shouldAutoScrollRef.current = true;
  }, [selectedThreadId]);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [inputValue, adjustHeight]);

  const handleSend = useCallback(() => {
    const text = inputValue.trim();
    if (!text || !selectedContactId) return;
    sendMessage(selectedContactId, text);
    setInputValue("");
  }, [inputValue, selectedContactId, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !isComposing.current) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!selectedThreadId) {
    return (
      <div className="peer-thread-empty">
        <p>대화를 선택하세요</p>
      </div>
    );
  }

  return (
    <div className="peer-thread">
      <header className="peer-thread-header">
        <button
          className="peer-thread-back"
          onClick={() => selectThread(null)}
          title="뒤로"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="peer-thread-agent-info">
          <span className="peer-thread-agent-name">
            {contact?.display_name || contact?.agent_name || "알 수 없음"}
          </span>
          <span className={`peer-thread-status ${isOnline ? "online" : "offline"}`}>
            {isOnline ? "● 연결됨" : "○ 오프라인"}
          </span>
        </div>
      </header>

      <div className="peer-thread-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <div className="peer-thread-no-messages">
            아직 메시지가 없습니다. 대화를 시작하세요.
          </div>
        ) : (
          messages.map((msg) => <PeerMessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="peer-thread-input-area">
        <div className="peer-thread-input-container">
          <textarea
            ref={textareaRef}
            className="peer-thread-input"
            placeholder="메시지를 입력하세요..."
            value={inputValue}
            rows={1}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { isComposing.current = true; }}
            onCompositionEnd={(e) => {
              isComposing.current = false;
              setInputValue((e.target as HTMLTextAreaElement).value);
            }}
          />
          <button
            className="send-button"
            onClick={handleSend}
            disabled={!inputValue.trim()}
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
