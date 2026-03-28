/**
 * Standalone side-effect helpers extracted from conversationStore.
 *
 * Each function accepts explicit dependencies (store getters/setters, Tauri commands)
 * rather than importing stores directly, making them testable and decoupled from
 * the Zustand store graph.
 */

import type { Conversation, ChatMessage, DbMessage, ConversationDetail, Agent } from "./types";
import { emitLifecycleEvent } from "./lifecycleEvents";

// ── Dependency interfaces ──────────────────────────────────────────

export interface ConsolidationDeps {
  triggerConsolidation: (conversationId: string, agentId: string) => void;
}

export interface AgentContextDeps {
  selectAgent: (agentId: string) => void;
  findAgent: (agentId: string) => Agent | undefined;
  loadMemoryNotes: (agentId: string) => void;
  loadVaultNotes: (agentId: string) => void;
  loadSkills: (folderName: string) => Promise<void>;
  restoreActiveSkills?: (folderName: string, skillNames: string[]) => Promise<void>;
}

export interface MessageSyncDeps {
  setMessages: (messages: ChatMessage[]) => void;
}

export interface SummarySyncDeps {
  loadSummary: (summary?: string, upToMessageId?: string) => void;
}

export interface DebugDeps {
  loadLogs: (conversationId: string) => void;
}

export interface ConsolidatedMemoryDeps {
  loadConsolidatedMemory: (agentId: string) => Promise<void>;
}

export interface CommandDeps {
  getConversationDetail: (id: string) => Promise<ConversationDetail>;
  getMessages: (id: string) => Promise<DbMessage[]>;
}

// ── Helper: End previous session ──────────────────────────────────

/**
 * Emit session:end lifecycle event and trigger consolidation for the
 * conversation that is being navigated away from. No-op when there is
 * no previous conversation or the previous conversation is the same
 * as the target.
 */
export function endPreviousSession(
  prevConversationId: string | null,
  conversations: Conversation[],
  deps: ConsolidationDeps,
  targetConversationId?: string,
): void {
  if (!prevConversationId) return;
  if (targetConversationId && prevConversationId === targetConversationId) return;

  const prevConv = conversations.find((c) => c.id === prevConversationId);
  if (!prevConv) return;

  emitLifecycleEvent({ type: "session:end", conversationId: prevConversationId, agentId: prevConv.agent_id });
  deps.triggerConsolidation(prevConversationId, prevConv.agent_id);
}

// ── Helper: Load agent context (memory, vault, skills) ────────────

/**
 * Select an agent and eagerly load its memory notes, vault notes, and skills.
 * Optionally restores active skills from a saved list.
 */
export async function loadAgentContext(
  agentId: string,
  deps: AgentContextDeps,
  activeSkills?: string[],
): Promise<void> {
  deps.selectAgent(agentId);
  deps.loadMemoryNotes(agentId);
  deps.loadVaultNotes(agentId);

  const agent = deps.findAgent(agentId);
  if (agent) {
    await deps.loadSkills(agent.folder_name);
    if (activeSkills && activeSkills.length > 0 && deps.restoreActiveSkills) {
      await deps.restoreActiveSkills(agent.folder_name, activeSkills);
    }
  }
}

// ── Helper: Map DB messages to ChatMessage[] ──────────────────────

/**
 * Convert raw DB messages into the ChatMessage shape consumed by the UI.
 * Filters out internal team synthesis context messages.
 */
export function mapDbMessages(
  dbMessages: DbMessage[],
  findAgent: (agentId: string) => Agent | undefined,
): ChatMessage[] {
  return dbMessages
    .filter((m) => !(m.role === "tool" && m.tool_name === "__team_synthesis_context"))
    .map((m) => {
      let chatMsg: ChatMessage;
      if (m.role === "user") {
        chatMsg = { id: m.id, dbMessageId: m.id, type: "user" as const, content: m.content, status: "complete" as const };
      } else if (m.tool_call_id) {
        chatMsg = {
          id: m.id, dbMessageId: m.id, type: "tool" as const, content: m.content, status: "complete" as const,
          tool_call_id: m.tool_call_id, tool_name: m.tool_name ?? undefined,
        };
      } else {
        chatMsg = { id: m.id, dbMessageId: m.id, type: "agent" as const, content: m.content, status: "complete" as const };
        if (m.tool_name && m.tool_input) {
          try {
            chatMsg.tool_calls = JSON.parse(m.tool_input);
          } catch { /* ignore parse errors */ }
        }
      }
      // Parse attachments JSON
      if (m.attachments) {
        try { chatMsg.attachments = JSON.parse(m.attachments); } catch { /* ignore */ }
      }
      // Map team sender metadata
      if (m.sender_agent_id) {
        chatMsg.senderAgentId = m.sender_agent_id;
        chatMsg.teamRunId = m.team_run_id ?? undefined;
        chatMsg.teamTaskId = m.team_task_id ?? undefined;
        const agent = findAgent(m.sender_agent_id);
        if (agent) {
          chatMsg.senderAgentName = agent.name;
          chatMsg.senderAgentAvatar = agent.avatar;
        }
      }
      return chatMsg;
    });
}

// ── Helper: Full conversation selection side-effects ──────────────

export interface OnConversationSelectedDeps {
  commands: CommandDeps;
  agentContext: AgentContextDeps;
  messageSync: MessageSyncDeps;
  summarySync: SummarySyncDeps;
  debug: DebugDeps;
  consolidatedMemory: ConsolidatedMemoryDeps;
  setLearningMode: (value: boolean) => void;
  getCurrentConversationId: () => string | null;
}

export interface OnConversationSelectedResult {
  messages: ChatMessage[];
  summary?: string;
  summaryUpToMessageId?: string;
}

/**
 * Execute the full side-effect chain when a conversation is selected:
 * 1. Load conversation detail + DB messages in parallel
 * 2. Map DB messages to ChatMessages
 * 3. Sync messages, summary, learning mode
 * 4. Load consolidated memory
 * 5. Load agent context (agent selection, memory, vault, skills)
 * 6. Load debug logs
 * 7. Emit session:start lifecycle event
 *
 * Returns early with empty messages if the conversation was superseded
 * (stale guard).
 */
export async function onConversationSelected(
  conversationId: string,
  deps: OnConversationSelectedDeps,
): Promise<OnConversationSelectedResult> {
  const [detail, dbMessages] = await Promise.all([
    deps.commands.getConversationDetail(conversationId),
    deps.commands.getMessages(conversationId),
  ]);

  // Stale guard — another conversation was selected while we were loading
  if (deps.getCurrentConversationId() !== conversationId) {
    return { messages: [] };
  }

  const messages = mapDbMessages(dbMessages, deps.agentContext.findAgent);

  deps.messageSync.setMessages(messages);
  deps.summarySync.loadSummary(detail.summary, detail.summary_up_to_message_id);
  deps.setLearningMode(detail.learning_mode ?? false);

  await deps.consolidatedMemory.loadConsolidatedMemory(detail.agent_id);

  if (detail.agent_id) {
    await loadAgentContext(detail.agent_id, deps.agentContext, detail.active_skills ?? undefined);
  }

  deps.debug.loadLogs(conversationId);
  emitLifecycleEvent({ type: "session:start", conversationId, agentId: detail.agent_id });

  return { messages, summary: detail.summary, summaryUpToMessageId: detail.summary_up_to_message_id };
}
