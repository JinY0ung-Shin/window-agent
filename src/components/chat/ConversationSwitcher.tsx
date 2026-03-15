import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useConversationStore } from "../../stores/conversationStore";
import { useAgentStore } from "../../stores/agentStore";
import { useStreamStore } from "../../stores/streamStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { useBootstrapStore } from "../../stores/bootstrapStore";
import { useLabels, useCompanyName } from "../../hooks/useLabels";
import { useMessageStore } from "../../stores/messageStore";
import type { Conversation } from "../../services/types";

// ── Date grouping ──────────────────────────────────────
interface DateGroup { key: string; label: string }

function getDateGroup(dateStr: string): DateGroup {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return { key: "unknown", label: "기타" };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return { key: "today", label: "오늘" };
  if (diffDays === 1) return { key: "yesterday", label: "어제" };
  if (diffDays < 7) return { key: "this-week", label: "이번 주" };
  // Use ISO date as stable key to avoid cross-year collisions
  const key = target.toISOString().slice(0, 10);
  const label = `${date.getMonth() + 1}월 ${date.getDate()}일`;
  return { key, label };
}

function groupByDate(conversations: Conversation[]): { key: string; label: string; convs: Conversation[] }[] {
  const groups: { key: string; label: string; convs: Conversation[] }[] = [];
  const keyIndex = new Map<string, number>();
  for (const conv of conversations) {
    const { key, label } = getDateGroup(conv.updated_at);
    const idx = keyIndex.get(key);
    if (idx !== undefined) {
      groups[idx].convs.push(conv);
    } else {
      keyIndex.set(key, groups.length);
      groups.push({ key, label, convs: [conv] });
    }
  }
  return groups;
}

// ── Component ──────────────────────────────────────────
export default function ConversationSwitcher() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const conversations = useConversationStore((s) => s.conversations);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const startNewAgentConversation = useConversationStore((s) => s.startNewAgentConversation);
  const selectedAgentId = useAgentStore((s) => s.selectedAgentId);
  const agents = useAgentStore((s) => s.agents);
  const isBootstrapping = useBootstrapStore((s) => s.isBootstrapping);
  const activeRun = useStreamStore((s) => s.activeRun);
  const toolRunState = useToolRunStore((s) => s.toolRunState);
  const labels = useLabels();
  const companyName = useCompanyName();
  const messages = useMessageStore((s) => s.messages);

  // Resolve current agent ID from conversation or selection.
  // Falls through to selectedAgentId when the conversation is not yet in the list
  // (e.g. optimistic new conversation before loadConversations()).
  const currentAgentId = useMemo(() => {
    if (currentConversationId) {
      const conv = conversations.find((c) => c.id === currentConversationId);
      if (conv) return conv.agent_id;
    }
    return selectedAgentId;
  }, [currentConversationId, conversations, selectedAgentId]);

  // Filter conversations for the current agent, sorted by updated_at DESC.
  // Includes an optimistic entry when a new conversation has been created
  // (currentConversationId is set) but loadConversations() hasn't run yet.
  const agentConversations = useMemo(() => {
    if (!currentAgentId) return [];
    const list = conversations
      .filter((c) => c.agent_id === currentAgentId)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

    // Optimistic fallback: if currentConversationId exists but isn't in the list yet
    if (
      currentConversationId &&
      !list.some((c) => c.id === currentConversationId)
    ) {
      const firstUserMsg = messages.find((m) => m.type === "user");
      const optimistic: Conversation = {
        id: currentConversationId,
        agent_id: currentAgentId,
        title: firstUserMsg?.content.slice(0, 50) ?? "새 대화",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      list.unshift(optimistic);
    }
    return list;
  }, [conversations, currentAgentId, currentConversationId, messages]);

  const dateGroups = useMemo(() => groupByDate(agentConversations), [agentConversations]);

  // Is the chat busy? (streaming, tool running, etc.)
  const isBusy = activeRun !== null || toolRunState !== "idle";

  // Resolve the displayed title
  const currentAgent = currentAgentId
    ? agents.find((a) => a.id === currentAgentId) ?? null
    : null;

  const displayTitle = isBootstrapping
    ? labels.bootstrapTitle
    : currentConversationId
      ? (conversations.find((c) => c.id === currentConversationId)?.title
          ?? agentConversations.find((c) => c.id === currentConversationId)?.title
          ?? "대화")
      : currentAgent
        ? currentAgent.name
        : labels.appTitle(companyName);

  // Can the dropdown be shown?
  const canShowDropdown = !isBootstrapping && currentAgentId !== null && agentConversations.length > 0;

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen]);

  const handleSelect = useCallback(
    (convId: string) => {
      if (isBusy || convId === currentConversationId) {
        setIsOpen(false);
        return;
      }
      selectConversation(convId);
      setIsOpen(false);
    },
    [isBusy, currentConversationId, selectConversation],
  );

  const handleNewConversation = useCallback(() => {
    if (isBusy || !currentAgentId) return;
    startNewAgentConversation(currentAgentId);
    setIsOpen(false);
  }, [isBusy, currentAgentId, startNewAgentConversation]);

  const handleToggle = useCallback(() => {
    if (canShowDropdown) setIsOpen((prev) => !prev);
  }, [canShowDropdown]);

  return (
    <div className="conversation-switcher" ref={dropdownRef}>
      <button
        className={`conversation-switcher-trigger ${canShowDropdown ? "clickable" : ""}`}
        onClick={handleToggle}
      >
        <span className="conversation-switcher-title">{displayTitle}</span>
        {canShowDropdown && (
          <ChevronDown
            size={14}
            className={`conversation-switcher-chevron ${isOpen ? "open" : ""}`}
          />
        )}
      </button>

      {isOpen && (
        <div className="conversation-switcher-dropdown">
          <button
            className={`conv-new-btn ${isBusy ? "disabled" : ""}`}
            onClick={handleNewConversation}
            disabled={isBusy}
          >
            <Plus size={14} />
            <span>{labels.newConversation}</span>
          </button>

          <div className="conv-list">
            {dateGroups.map((group) => (
              <div key={group.key} className="conv-date-group">
                <div className="conv-date-header">{group.label}</div>
                {group.convs.map((conv) => (
                  <button
                    key={conv.id}
                    className={`conv-item ${conv.id === currentConversationId ? "active" : ""} ${isBusy ? "disabled" : ""}`}
                    onClick={() => handleSelect(conv.id)}
                    disabled={isBusy}
                  >
                    <span className="conv-item-title">{conv.title}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
