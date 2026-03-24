import React, { useState, useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Send, Settings } from "lucide-react";
import { i18n } from "../../i18n";
import { useNetworkStore } from "../../stores/networkStore";
import type { PeerMessageRow } from "../../services/commands/relayCommands";
import DeliveryBadge from "./DeliveryBadge";
import ContactDetail from "./ContactDetail";
import DraggableHeader from "../layout/DraggableHeader";

function PeerMessageBubble({ msg }: { msg: PeerMessageRow }) {
  const isOutgoing = msg.direction === "outgoing";

  const time = (() => {
    try {
      const d = new Date(msg.created_at);
      const intlLocale = i18n.language === "en" ? "en-US" : "ko-KR";
      return d.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit" });
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
    </div>
  );
}

interface PeerThreadProps {
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

export default function PeerThread({ settingsOpen, onToggleSettings }: PeerThreadProps) {
  const { t } = useTranslation("network");
  const messages = useNetworkStore((s) => s.messages);
  const selectedThreadId = useNetworkStore((s) => s.selectedThreadId);
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const sendMessage = useNetworkStore((s) => s.sendMessage);

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

  return (
    <div className="peer-thread">
      <DraggableHeader className="peer-thread-header">
        <div className="peer-thread-agent-info">
          <span className="peer-thread-agent-name">
            {contact?.display_name || contact?.agent_name || t("peer.unknown")}
          </span>
          <span className={`peer-thread-status ${isOnline ? "online" : "offline"}`}>
            {isOnline ? t("peer.online") : t("peer.offline")}
          </span>
        </div>
        <button
          className={`icon-btn${settingsOpen ? " active" : ""}`}
          onClick={onToggleSettings}
          title={t("contact.detailTitle")}
        >
          <Settings size={16} />
        </button>
      </DraggableHeader>

      {settingsOpen && (
        <div className="peer-thread-settings">
          <ContactDetail />
        </div>
      )}

      <div className="peer-thread-messages" ref={containerRef}>
        {messages.length === 0 ? (
          <div className="peer-thread-no-messages">
            {t("peer.noMessages")}
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
            placeholder={t("peer.inputPlaceholder")}
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
