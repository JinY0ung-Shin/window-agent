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
  const isPending =
    contact?.status === "pending_approval" || contact?.status === "pending_outgoing";
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
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Sync selectedAgentId with locked agent when messages change
  useEffect(() => {
    if (isAgentLocked) {
      setSelectedAgentId(lockedAgentId);
    }
  }, [isAgentLocked, lockedAgentId]);

  const selectedAgent = publishedAgents.find((a) => a.agent_id === selectedAgentId);

  const localValueRef = useRef("");
  // Restore typed text into the (isolated) textarea after an optimistic clear.
  const restoreTextRef = useRef<((text: string) => void) | null>(null);

  const sendPeerMessage = useCallback(() => {
    const text = localValueRef.current.trim();
    if (!text || !selectedContactId || isPending || sending) return;
    setSending(true);
    setSendError(null);
    sendMessage(selectedContactId, text, selectedAgentId || undefined)
      .catch(() => {
        // Restore the optimistically-cleared text so the message isn't lost.
        restoreTextRef.current?.(text);
        setSendError(t("common:errors.sendFailed"));
      })
      .finally(() => setSending(false));
  }, [selectedContactId, sendMessage, selectedAgentId, isPending, sending, t]);

  const { textareaProps, localValue, flushAndSend, handleChange } = useChatInputLogic({
    sendFn: sendPeerMessage,
    disabled: isPending || sending,
    isolated: true,
  });

  localValueRef.current = localValue;
  restoreTextRef.current = (text: string) => {
    // handleChange only reads e.target.value, so a minimal synthetic event suffices.
    handleChange({ target: { value: text } } as unknown as React.ChangeEvent<HTMLTextAreaElement>);
  };

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

  // Close picker on Escape and return focus to the trigger
  const handlePickerKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape" && showAgentPicker) {
      e.preventDefault();
      setShowAgentPicker(false);
      triggerRef.current?.focus();
    }
  }, [showAgentPicker]);

  return (
    <div className="peer-thread-input-area">
      {publishedAgents.length > 0 && (
        <div className="peer-agent-picker-wrap" ref={pickerRef} onKeyDown={handlePickerKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            className={`peer-agent-picker-trigger${isAgentLocked ? " locked" : ""}`}
            onClick={() => !isAgentLocked && setShowAgentPicker(!showAgentPicker)}
            disabled={isAgentLocked}
            aria-haspopup="listbox"
            aria-expanded={showAgentPicker}
            title={isAgentLocked ? t("peer.agentLocked") : t("peer.selectAgent")}
          >
            {isAgentLocked ? <Lock size={14} /> : <Bot size={14} />}
            <span className="peer-agent-picker-label">
              {selectedAgent ? selectedAgent.name : t("peer.defaultAgent")}
            </span>
            {!isAgentLocked && <ChevronDown size={12} className={showAgentPicker ? "rotated" : ""} />}
          </button>
          {showAgentPicker && !isAgentLocked && (
            <div className="peer-agent-picker-dropdown" role="listbox">
              <button
                type="button"
                role="option"
                aria-selected={!selectedAgentId}
                className={`peer-agent-picker-option${!selectedAgentId ? " active" : ""}`}
                onClick={() => { setSelectedAgentId(""); setShowAgentPicker(false); }}
              >
                <span className="peer-agent-picker-option-name">{t("peer.defaultAgent")}</span>
              </button>
              {publishedAgents.map((a) => (
                <button
                  key={a.agent_id}
                  type="button"
                  role="option"
                  aria-selected={selectedAgentId === a.agent_id}
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
      {isPending && (
        <div className="peer-thread-pending-banner">{t("peer.pendingApprovalHint")}</div>
      )}
      {sendError && (
        <div className="peer-thread-send-error form-text text-error" role="alert">{sendError}</div>
      )}
      <div className="peer-thread-input-container">
        <textarea
          {...textareaProps}
          className="peer-thread-input"
          placeholder={isPending ? t("peer.pendingApprovalHint") : t("peer.inputPlaceholder")}
        />
        <button
          type="button"
          className="send-button"
          onClick={flushAndSend}
          disabled={!localValue.trim() || isPending || sending}
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
