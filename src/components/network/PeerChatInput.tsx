import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";
import type { PublishedAgent } from "../../services/types";

export default function PeerChatInput() {
  const { t } = useTranslation("network");
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const contacts = useNetworkStore((s) => s.contacts);
  const sendMessage = useNetworkStore((s) => s.sendMessage);

  const contact = contacts.find((c) => c.id === selectedContactId);
  const publishedAgents: PublishedAgent[] = useMemo(() => {
    if (!contact?.published_agents_json) return [];
    try { return JSON.parse(contact.published_agents_json); } catch { return []; }
  }, [contact?.published_agents_json]);

  const [selectedAgentId, setSelectedAgentId] = useState<string>("");

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

  return (
    <div className="peer-thread-input-area">
      {publishedAgents.length > 0 && (
        <div className="peer-agent-selector">
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
          >
            <option value="">{t("peer.defaultAgent")}</option>
            {publishedAgents.map((a) => (
              <option key={a.agent_id} value={a.agent_id}>{a.name}</option>
            ))}
          </select>
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
