import { useRef, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Users, ArrowLeft } from "lucide-react";
import { useMessageStore } from "../../stores/messageStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamRunStore } from "../../stores/teamRunStore";
import { useTeamChatFlowStore } from "../../stores/teamChatFlowStore";
import { useAgentStore } from "../../stores/agentStore";
import AgentMessageBubble from "./AgentMessageBubble";
import TeamChatInput from "./TeamChatInput";
import { useDragRegion } from "../../hooks/useDragRegion";

export default function TeamChatWindow() {
  const { t } = useTranslation("team");
  const messages = useMessageStore((s) => s.messages);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const teams = useTeamStore((s) => s.teams);
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const agents = useAgentStore((s) => s.agents);
  const activeRuns = useTeamRunStore((s) => s.activeRuns);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const shouldAutoScrollRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const onDrag = useDragRegion();

  const team = teams.find((t) => t.id === selectedTeamId) ?? null;

  // Find leader agent id from active runs or team
  const leaderAgentId = (() => {
    const runIds = Object.keys(activeRuns);
    if (runIds.length > 0) {
      return activeRuns[runIds[runIds.length - 1]].leader_agent_id;
    }
    return team?.leader_agent_id ?? null;
  })();

  // Setup team listeners on mount
  useEffect(() => {
    const flowCleanup = useTeamChatFlowStore.getState().setupTeamListeners();
    const runCleanup = useTeamRunStore.getState().setupListeners();
    return () => {
      flowCleanup.then((fn) => fn());
      runCleanup.then((fn) => fn());
    };
  }, []);

  const isNearBottom = useCallback(() => {
    const el = messagesContainerRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
  }, []);

  // Scroll tracking
  useEffect(() => {
    const el = messagesContainerRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY < -2) {
        shouldAutoScrollRef.current = false;
      } else if (event.deltaY > 2 && isNearBottom()) {
        shouldAutoScrollRef.current = true;
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const onTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY;
      if (currentY == null || touchStartYRef.current == null) return;
      if (currentY > touchStartYRef.current + 4) {
        shouldAutoScrollRef.current = false;
      } else if (currentY < touchStartYRef.current - 4 && isNearBottom()) {
        shouldAutoScrollRef.current = true;
      }
    };

    const onScroll = () => {
      const currentScrollTop = el.scrollTop;
      const scrollingUp = currentScrollTop < lastScrollTopRef.current - 4;
      const nearBottom = isNearBottom();
      if (scrollingUp) {
        shouldAutoScrollRef.current = false;
      } else if (nearBottom) {
        shouldAutoScrollRef.current = true;
      }
      lastScrollTopRef.current = currentScrollTop;
    };

    const onTouchEnd = () => {
      touchStartYRef.current = null;
    };

    el.addEventListener("wheel", onWheel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("scroll", onScroll);
    };
  }, [isNearBottom]);

  // Reset auto-scroll on conversation change
  useEffect(() => {
    shouldAutoScrollRef.current = true;
    lastScrollTopRef.current = 0;
  }, [currentConversationId, selectedTeamId]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (shouldAutoScrollRef.current) {
      scrollToBottom();
    }
  }, [messages, scrollToBottom]);

  // Member count for header
  const memberCount = team
    ? agents.filter((a) =>
        a.id === team.leader_agent_id ||
        messages.some((m) => m.senderAgentId === a.id),
      ).length
    : 0;

  // Empty state
  if (!team) {
    return (
      <main className="main-area">
        <div className="team-chat-empty">
          <Users size={48} strokeWidth={1} />
          <p>{t("chat.selectTeam")}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="main-area">
      <header className="chat-header team-chat-header" onMouseDown={onDrag}>
        <button
          className="team-back-btn"
          onClick={() => {
            selectTeam(null);
            useConversationStore.getState().setCurrentConversationId(null);
          }}
          title={t("chat.backToTeams")}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="team-chat-header-info">
          <Users size={18} />
          <span className="team-chat-header-name">{team.name}</span>
          <span className="team-chat-header-count">
            {t("memberCount", { count: memberCount })}
          </span>
        </div>
      </header>

      <div className="chat-container team-chat-container" ref={messagesContainerRef}>
        {messages.length === 0 ? (
          <div className="team-chat-empty-conv">
            <Users size={40} strokeWidth={1} />
            <p>{t("chat.emptyConversation")}</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <AgentMessageBubble
                key={msg.id}
                message={msg}
                isLeader={msg.senderAgentId === leaderAgentId}
              />
            ))}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <TeamChatInput />
    </main>
  );
}
