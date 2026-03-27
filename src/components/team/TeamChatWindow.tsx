import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Users, ArrowLeft } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "../../services/types";
import { useMessageStore } from "../../stores/messageStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamRunStore } from "../../stores/teamRunStore";
import { useTeamChatFlowStore } from "../../stores/teamChatFlowStore";
import { useAgentStore } from "../../stores/agentStore";
import { useToolRunStore } from "../../stores/toolRunStore";
import { buildChatRenderBlocks, groupConsecutiveToolRuns } from "../chat/chatRenderBlocks";
import ToolRunBlock from "../chat/ToolRunBlock";
import ToolRunGroup from "../chat/ToolRunGroup";
import ChatMessageComponent from "../chat/ChatMessage";
import TeamChatInput from "./TeamChatInput";
import { useDragRegion } from "../../hooks/useDragRegion";
import { useMessageScroll } from "../../hooks/useMessageScroll";
import { emitLifecycleEvent } from "../../services/lifecycleEvents";
import { resetTransientChatState, resetTeamRunState } from "../../stores/resetHelper";

export default function TeamChatWindow() {
  const { t } = useTranslation("team");
  const messages = useMessageStore((s) => s.messages);
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  const selectedTeamId = useTeamStore((s) => s.selectedTeamId);
  const teams = useTeamStore((s) => s.teams);
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const agents = useAgentStore((s) => s.agents);
  const activeRuns = useTeamRunStore((s) => s.activeRuns);

  // Derive the latest team runId for per-run tool state
  const activeTeamRunId = (() => {
    const runIds = Object.keys(activeRuns);
    return runIds.length > 0 ? runIds[runIds.length - 1] : undefined;
  })();
  const toolRunState = useToolRunStore((s) =>
    activeTeamRunId ? (s.toolRunStates[activeTeamRunId] ?? "idle") : s.toolRunState,
  );
  const pendingToolCalls = useToolRunStore((s) =>
    activeTeamRunId ? (s.pendingToolCallsByRun[activeTeamRunId] ?? []) : s.pendingToolCalls,
  );

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

  const getSenderInfo = (msg: ChatMessageType) => {
    if (!msg.senderAgentId) return undefined;
    return {
      agentName: msg.senderAgentName,
      agentAvatar: msg.senderAgentAvatar,
      isLeader: msg.senderAgentId === leaderAgentId,
    };
  };

  // Setup team listeners on mount
  useEffect(() => {
    const flowCleanup = useTeamChatFlowStore.getState().setupTeamListeners();
    const runCleanup = useTeamRunStore.getState().setupListeners();
    return () => {
      flowCleanup.then((fn) => fn());
      runCleanup.then((fn) => fn());
    };
  }, []);

  const { messagesEndRef, messagesContainerRef } = useMessageScroll(
    [currentConversationId, selectedTeamId],
    [messages],
  );

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
          className="icon-btn team-back-btn"
          onClick={() => {
            const convStore = useConversationStore.getState();
            const convId = convStore.currentConversationId;
            if (convId) {
              const convObj = convStore.conversations.find((c) => c.id === convId);
              if (convObj) {
                emitLifecycleEvent({ type: "session:end", conversationId: convId, agentId: convObj.agent_id });
                convStore.triggerConsolidation(convId, convObj.agent_id);
              }
            }
            selectTeam(null);
            convStore.setCurrentConversationId(null);
            resetTransientChatState();
            resetTeamRunState();
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
            {groupConsecutiveToolRuns(buildChatRenderBlocks(messages, toolRunState, pendingToolCalls)).map((block) => {
              if (block.type === "tool_run") {
                return (
                  <ToolRunBlock
                    key={block.key}
                    assistantMessage={block.assistantMessage}
                    steps={block.steps}
                    isActiveRun={block.isActiveRun}
                    leadingContent={block.leadingContent}
                    senderInfo={getSenderInfo(block.assistantMessage)}
                    runId={activeTeamRunId}
                  />
                );
              }
              if (block.type === "tool_run_group") {
                const firstSender = getSenderInfo(block.runs[0].assistantMessage);
                return <ToolRunGroup key={block.key} runs={block.runs} senderInfo={firstSender} />;
              }
              if (block.type === "orphan_tool_result") {
                return <ChatMessageComponent key={block.key} message={block.message} senderInfo={getSenderInfo(block.message)} />;
              }
              return <ChatMessageComponent key={block.key} message={block.message} senderInfo={getSenderInfo(block.message)} />;
            })}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      <TeamChatInput />
    </main>
  );
}
