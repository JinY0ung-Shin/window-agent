import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, ChevronDown, Bot, Lock } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";
import type { PublishedAgent } from "../../services/types";

export default function PeerChatInput() {
  const { t } = useTranslation("network");
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const messages = useNetworkStore((s) => s.messages);
  const sendMessage = useNetworkStore((s) => s.sendMessage);

  const contact = contacts.find((c) => c.id === selectedContactId);
  const publishedAgents: PublishedAgent[] = useMemo(() => {
    if (!contact?.published_agents_json) return [];
    try { return JSON.parse(contact.published_agents_json); } catch { return []; }
  }, [contact?.published_agents_json]);

  // Check if there are user-sent outgoing messages → lock agent picker to latest target
  const lockedAgentId = useMemo(() => {
    const userMsgs = messages.filter(
      (m) => m.direction === "outgoing" && !m.responding_agent_id,
    );
    if (userMsgs.length === 0) return null;
    const lastMsg = userMsgs[userMsgs.length - 1];
    return lastMsg.target_agent_id ?? "";
  }, [messages]);

  const isAgentLocked = lockedAgentId !== null;

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Sync selectedAgentId with locked agent when messages change
  useEffect(() => {
    if (isAgentLocked) {
      setSelectedAgentId(lockedAgentId);
    }
  }, [isAgentLocked, lockedAgentId]);

  const selectedAgent = publishedAgents.find((a) => a.agent_id === selectedAgentId);

  const localValueRef = useRef("");

  const sendPeerMessage = useCallback(() => {
    const text = localValueRef.current.trim();
    if (!text || !selectedContactId) return;
    sendMessage(selectedContactId, text, selectedAgentId || undefined);
  }, [selectedContactId, sendMessage, selectedAgentId]);

  const { textareaProps, localValue, flushAndSend } = useChatInputLogic({
    sendFn: sendPeerMessage,
    disabled: false,
    isolated: true,
  });

  localValueRef.current = localValue;

  // Close picker on click outside
  useEffect(() => {
    if (!showAgentPicker) return;
    const handleClick = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowAgentPicker(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showAgentPicker]);

  return (
    <div className="peer-thread-input-area">
      {publishedAgents.length > 0 && (
        <div className="peer-agent-picker-wrap" ref={pickerRef}>
          <button
            className={`peer-agent-picker-trigger${isAgentLocked ? " locked" : ""}`}
            onClick={() => !isAgentLocked && setShowAgentPicker(!showAgentPicker)}
            disabled={isAgentLocked}
            title={isAgentLocked ? t("peer.agentLocked") : t("peer.selectAgent")}
          >
            {isAgentLocked ? <Lock size={14} /> : <Bot size={14} />}
            <span className="peer-agent-picker-label">
              {selectedAgent ? selectedAgent.name : t("peer.defaultAgent")}
            </span>
            {!isAgentLocked && <ChevronDown size={12} className={showAgentPicker ? "rotated" : ""} />}
          </button>
          {showAgentPicker && !isAgentLocked && (
            <div className="peer-agent-picker-dropdown">
              <button
                className={`peer-agent-picker-option${!selectedAgentId ? " active" : ""}`}
                onClick={() => { setSelectedAgentId(""); setShowAgentPicker(false); }}
              >
                <span className="peer-agent-picker-option-name">{t("peer.defaultAgent")}</span>
              </button>
              {publishedAgents.map((a) => (
                <button
                  key={a.agent_id}
                  className={`peer-agent-picker-option${selectedAgentId === a.agent_id ? " active" : ""}`}
                  onClick={() => { setSelectedAgentId(a.agent_id); setShowAgentPicker(false); }}
                >
                  <span className="peer-agent-picker-option-name">{a.name}</span>
                  {a.description && (
                    <span className="peer-agent-picker-option-desc">{a.description}</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="peer-thread-input-container">
        <textarea
          {...textareaProps}
          className="peer-thread-input"
          placeholder={t("peer.inputPlaceholder")}
        />
        <button
          className="send-button"
          onClick={flushAndSend}
          disabled={!localValue.trim()}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
