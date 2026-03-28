import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Send, Square, GraduationCap, ImagePlus, X } from "lucide-react";
import { useChatFlowStore } from "../../stores/chatFlowStore";
import { useStreamStore } from "../../stores/streamStore";
import { useMessageStore, type PendingAttachment } from "../../stores/messageStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useChatInputLogic } from "../../hooks/useChatInputLogic";

export default function ChatInput() {
  const { t } = useTranslation("chat");
  const sendMessage = useChatFlowStore((s) => s.sendMessage);
  const abortStream = useStreamStore((s) => s.abortStream);
  const messages = useMessageStore((s) => s.messages);
  const pendingAttachments = useMessageStore((s) => s.pendingAttachments);
  const addPendingAttachment = useMessageStore((s) => s.addPendingAttachment);
  const removePendingAttachment = useMessageStore((s) => s.removePendingAttachment);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const isSending = messages.some((m) => m.status === "pending" || m.status === "streaming");
  const isToolBusy = toolRunState === "tool_pending" || toolRunState === "tool_waiting" || toolRunState === "tool_running" || toolRunState === "continuing";
  const learningMode = useConversationStore((s) => s.getCurrentLearningMode());
  const toggleLearningMode = useConversationStore((s) => s.toggleLearningMode);
  const learningModeWarning = useConversationStore((s) => s.learningModeWarning);
  const dismissWarning = useConversationStore((s) => s.dismissLearningModeWarning);
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const isBusy = isSending || isToolBusy;
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { textareaProps, localValue, flushAndSend } = useChatInputLogic({
    sendFn: sendMessage,
    disabled: isToolBusy,
  });

  const placeholder = toolRunState === "tool_waiting"
    ? t("input.placeholder.toolWaiting")
    : toolRunState === "tool_running"
      ? t("input.placeholder.toolRunning")
      : toolRunState === "continuing"
        ? t("input.placeholder.toolContinuing")
        : t("input.placeholder.idle");

  const learningModeLabel = t("glossary:learningMode", { context: uiTheme });
  const learningModeTooltip = t("chat:learningMode.tooltip", { context: uiTheme });
  const learningModeWarningText = t("chat:learningMode.warning", { context: uiTheme });

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    for (const file of files) {
      if (!file.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const att: PendingAttachment = { type: "image", path: "", dataUrl };
        addPendingAttachment(att);
      };
      reader.readAsDataURL(file);
    }
    // Reset so the same file can be selected again
    e.target.value = "";
  };

  const hasPendingImages = pendingAttachments.length > 0;

  return (
    <div className="input-area" data-tour-id="chat-input">
      <div className="input-toolbar">
        <button
          className={`learning-mode-toggle${learningMode ? " active" : ""}`}
          onClick={toggleLearningMode}
          disabled={isBusy}
          title={learningMode ? learningModeTooltip : learningModeLabel}
        >
          <GraduationCap size={16} />
          {learningMode && <span className="learning-mode-label">{learningModeLabel}</span>}
        </button>
        {learningModeWarning && (
          <span className="learning-mode-warning" onClick={dismissWarning}>
            {learningModeWarningText}
          </span>
        )}
      </div>
      {hasPendingImages && (
        <div className="pending-attachments">
          {pendingAttachments.map((att, i) => (
            <div key={i} className="pending-attachment-thumb">
              <img src={att.dataUrl} alt="Attachment preview" />
              <button className="remove-attachment" onClick={() => removePendingAttachment(i)}>
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="input-container">
        <button
          className="image-attach-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy || pendingAttachments.length >= 4}
          title={t("input.attachImage", { defaultValue: "Attach image" })}
        >
          <ImagePlus size={18} />
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />
        <textarea
          {...textareaProps}
          className="chat-input"
          placeholder={placeholder}
        />
        {isSending || isToolBusy ? (
          <button className="send-button cancel" onClick={abortStream} title={t("input.cancelTitle")}>
            <Square size={18} />
          </button>
        ) : (
          <button
            className="send-button"
            onClick={flushAndSend}
            disabled={!localValue.trim() && !hasPendingImages}
          >
            <Send size={18} />
          </button>
        )}
      </div>
    </div>
  );
}
