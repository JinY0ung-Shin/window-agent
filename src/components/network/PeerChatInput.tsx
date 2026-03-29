import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send } from "lucide-react";
import { useNetworkStore } from "../../stores/networkStore";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";

export default function PeerChatInput() {
  const { t } = useTranslation("network");
  const selectedContactId = useNetworkStore((s) => s.selectedContactId);
  const sendMessage = useNetworkStore((s) => s.sendMessage);

  // localValueRef lets sendFn read the current input value without
  // creating a new function on every keystroke.
  const localValueRef = useRef("");

  const sendPeerMessage = useCallback(() => {
    const text = localValueRef.current.trim();
    if (!text || !selectedContactId) return;
    sendMessage(selectedContactId, text);
  }, [selectedContactId, sendMessage]);

  const { textareaProps, localValue, flushAndSend } = useChatInputLogic({
    sendFn: sendPeerMessage,
    disabled: false,
    isolated: true,
  });

  // Keep ref in sync for sendFn
  localValueRef.current = localValue;

  return (
    <div className="peer-thread-input-area">
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
