import { create } from "zustand";
import type { Agent, ChatMessage, Conversation, SkillMetadata } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useSkillStore } from "./skillStore";
import { useBootstrapStore } from "./bootstrapStore";
import { useNavigationStore } from "./navigationStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useToolRunStore } from "./toolRunStore";
import { useSummaryStore } from "./summaryStore";
import { resetChatContext } from "./resetHelper";
import {
  readBootFile,
  invalidatePersonaCache,
} from "../services/personaService";
import {
  executeBootstrapTurn,
  parseAgentName,
  isBootstrapComplete,
} from "../services/bootstrapService";
import { parseErrorMessage } from "../constants";
import { toErrorMessage } from "../utils/errorUtils";
import { i18n } from "../i18n";
import { emitLifecycleEvent, onLifecycleEvent } from "../services/lifecycleEvents";
import {
  msg, conv, stream, boot, summary,
  createPendingMessage,
  updateMessageInList,
} from "../services/streamHelpers";
import { logger } from "../services/logger";
import {
  resolveAgentForConversation,
  ensureConversation,
  streamOneTurn,
  runToolLoop,
  resolveEffectiveSettings,
  resolveToolConfig,
  resolveSystemPrompt,
  resolveWorkspacePath,
  saveFinalResponse,
  handleStreamError,
  handleStreamAbort,
} from "./chatFlowBase";

// ── Per-conversation BOOT.md cache (for regenerate) ──
const bootContentCache = new Map<string, string>();

// Evict boot cache on session end to prevent unbounded growth
onLifecycleEvent((event) => {
  if (event.type === "session:end") {
    bootContentCache.delete(event.conversationId);
  }
});

// ── ChatFlowStore ─────────────────────────────────────

interface ChatFlowState {
  sendMessage: () => Promise<void>;
  regenerateMessage: (messageId: string) => Promise<void>;
  prepareForAgent: (agentId: string) => void;
}

export const useChatFlowStore = create<ChatFlowState>((_set, _get) => ({
  sendMessage: async () => {
    const { inputValue } = msg();
    const { isBootstrapping } = boot();
    if (!inputValue.trim()) return;

    const trimmed = inputValue.trim();

    // Dispatch slash commands BEFORE env hydration so local commands work immediately
    const command = matchSlashCommand(trimmed);
    if (command) {
      await command.handler(trimmed);
      return;
    }

    await useSettingsStore.getState().waitForEnv();
    const settings = useSettingsStore.getState();
    if (!settings.hasApiKey) {
      useNavigationStore.getState().setMainView("settings");
      return;
    }

    if (isBootstrapping) {
      await sendBootstrapMessage();
    } else {
      await sendNormalMessage();
    }
  },

  regenerateMessage: async (messageId: string) => {
    const { messages } = msg();
    const { activeRun } = stream();
    const { currentConversationId } = conv();
    if (!currentConversationId || activeRun) return;

    const idx = messages.findIndex((m: ChatMessage) => m.id === messageId);
    if (idx < 0) return;

    const targetMsg = messages[idx];
    const truncated = messages.slice(0, idx);

    if (targetMsg.dbMessageId) {
      const result = await cmds.deleteMessagesAndMaybeResetSummary(currentConversationId, targetMsg.dbMessageId);
      if (result.summary_was_reset) {
        useSummaryStore.setState({ currentSummary: null, summaryUpToMessageId: null });
      }
    }

    useMessageStore.setState({ messages: truncated });

    const lastUserMsg = [...truncated].reverse().find((m: ChatMessage) => m.type === "user");
    if (!lastUserMsg) return;

    await regenerateStream(currentConversationId, truncated, lastUserMsg.content);
  },

  prepareForAgent: (agentId: string) => {
    resetChatContext();
    useAgentStore.getState().selectAgent(agentId);
    conv().loadConsolidatedMemory(agentId);
    const agent = useAgentStore.getState().agents.find((a: Agent) => a.id === agentId);
    if (agent) {
      useSkillStore.getState().loadSkills(agent.folder_name);
    }
  },
}));

// ── Slash command registry ────────────────────────────

interface SlashCommand {
  name: string;
  aliases: string[];
  description: string;
  requiresApiKey: boolean;
  requiresAgent: boolean;
  handler: (args: string) => Promise<void>;
}

const slashCommands: SlashCommand[] = [
  {
    name: "/skill",
    aliases: [],
    description: i18n.t("agent:skills.slashDescription"),
    requiresApiKey: false,
    requiresAgent: false,
    handler: handleSkillCommand,
  },
];

function matchSlashCommand(input: string): SlashCommand | null {
  const lower = input.toLowerCase();
  for (const cmd of slashCommands) {
    if (lower.startsWith(cmd.name)) return cmd;
    for (const alias of cmd.aliases) {
      if (lower.startsWith(alias)) return cmd;
    }
  }
  return null;
}

// ── Skill slash command handler ──────────────────────

async function handleSkillCommand(command: string) {
  const skillStore = useSkillStore.getState();
  const theme = useSettingsStore.getState().uiTheme;
  const { currentConversationId, conversations } = conv();

  const parts = command.split(/\s+/);
  const subCommand = parts[1];
  const skillName = parts.slice(2).join(" ");

  let resultMessage = "";

  if (!subCommand) {
    const available = skillStore.availableSkills;
    const active = skillStore.activeSkillNames;
    resultMessage =
      `**${i18n.t("agent:skills.available")}**\n${
        available
          .map(
            (s: SkillMetadata) =>
              `- ${active.includes(s.name) ? "\u2705" : "\u2B1C"} ${s.name}: ${s.description}`,
          )
          .join("\n") || i18n.t("common:none")
      }\n\n${i18n.t("agent:skills.activeCount", { count: active.length })} | ${i18n.t("agent:skills.tokenCount", { tokens: skillStore.activeSkillTokens })}`;
  } else if ((subCommand === "장착" || subCommand === "equip") && skillName) {
    const convObj = conversations.find((c: Conversation) => c.id === currentConversationId);
    const agentId = convObj?.agent_id ?? useAgentStore.getState().selectedAgentId;
    const agent = agentId
      ? useAgentStore.getState().agents.find((a: Agent) => a.id === agentId)
      : null;
    if (agent) {
      const success = await skillStore.activateSkill(
        agent.folder_name,
        skillName,
        currentConversationId ?? undefined,
      );
      resultMessage = success
        ? `\u2705 ${i18n.t("agent:skills.equipped", { name: skillName })} (${i18n.t("agent:skills.tokenCount", { tokens: skillStore.activeSkillTokens })})`
        : `\u274C ${i18n.t("agent:skills.failed", { name: skillName, error: i18n.t("agent:skills.tokenLimitExceeded") })}`;
    } else {
      resultMessage = `\u274C ${i18n.t("glossary:noAgentForSkill", { context: theme })}`;
    }
  } else if ((subCommand === "해제" || subCommand === "unequip") && skillName) {
    await skillStore.deactivateSkill(
      skillName,
      currentConversationId ?? undefined,
    );
    resultMessage = i18n.t("agent:skills.unequipped", { name: skillName });
  } else {
    resultMessage = i18n.t("agent:skills.slashUsage");
  }

  const sysMsg: ChatMessage = {
    id: `skill-cmd-${Date.now()}`,
    type: "agent",
    content: resultMessage,
    status: "complete",
  };
  useMessageStore.setState({ messages: [...msg().messages, sysMsg], inputValue: "" });
}

// ── Normal message flow ────────────────────────────────

async function sendNormalMessage() {
  const inputValue = msg().inputValue;
  const currentConversationId = conv().currentConversationId;
  const messages = msg().messages;
  const conversations = conv().conversations;
  const settings = useSettingsStore.getState();

  const { agentId, agent } = resolveAgentForConversation(currentConversationId, conversations);

  if (agent && useSkillStore.getState().availableSkills.length === 0) {
    await useSkillStore.getState().loadSkills(agent.folder_name);
  }

  const convResult = await ensureConversation(
    { currentConversationId, agentId, agent, inputValue, emitLifecycleEvent },
    {
      loadSkills: (fn) => useSkillStore.getState().loadSkills(fn),
      getActiveSkillNames: () => useSkillStore.getState().activeSkillNames,
      getDraftLearningMode: () => conv().draftLearningMode,
    },
  );
  if (!convResult) return;
  const { convId, isNew } = convResult;

  // Load BOOT.md for new conversations (cached for regenerate)
  let bootContent: string | null | undefined;
  if (isNew && agent) {
    bootContent = await readBootFile(agent.folder_name);
    if (bootContent) {
      bootContentCache.set(convId, bootContent);
    }
  }

  const savedUser = await cmds.saveMessage({
    conversation_id: convId,
    role: "user",
    content: inputValue,
  });

  const userMsg: ChatMessage = {
    id: savedUser.id,
    dbMessageId: savedUser.id,
    type: "user",
    content: inputValue,
    status: "complete",
  };

  const currentRequestId = `req-${Date.now()}`;
  const { msgId: firstMsgId, msg: pendingMsg } = createPendingMessage(currentRequestId);

  useMessageStore.setState({
    messages: [...messages, userMsg, pendingMsg],
    inputValue: "",
  });
  useStreamStore.setState({
    activeRun: {
      requestId: currentRequestId,
      conversationId: convId,
      targetMessageId: firstMsgId,
      status: "pending",
    },
  });

  try {
    const effective = resolveEffectiveSettings(agent);
    const { toolDefinitions, autoApproveEnabled, agentHasCredentials, credentialsSection, openAITools } = await resolveToolConfig(agent);

    const enabledToolNames = toolDefinitions.map((t) => t.name);
    const baseSystemPrompt = await resolveSystemPrompt(agent, enabledToolNames, settings.companyName);

    const skillsSection = useSkillStore.getState().getSkillsPromptSection();
    const workspacePath = await resolveWorkspacePath(convId);

    await runToolLoop(
      {
        convId, baseSystemPrompt, effective, toolDefinitions,
        autoApproveEnabled, agentHasCredentials, credentialsSection, openAITools, skillsSection, workspacePath, bootContent,
      },
      { currentRequestId, currentMsgId: firstMsgId },
    );
  } catch (error) {
    handleStreamError(error, firstMsgId);
  }

  try {
    await conv().loadConversations();
  } catch (error) {
    logger.error("Failed to reload conversations after message:", error);
  }
}

// ── Regenerate stream flow ──────────────────────────────

async function regenerateStream(
  convId: string,
  truncated: ChatMessage[],
  _lastUserContent: string,
) {
  const settings = useSettingsStore.getState();
  const conversations = conv().conversations;

  const { agent } = resolveAgentForConversation(convId, conversations);

  const requestId = `req-${Date.now()}`;
  const { msgId, msg: pendingMsg } = createPendingMessage(requestId);

  useMessageStore.setState({ messages: [...truncated, pendingMsg] });
  useStreamStore.setState({
    activeRun: {
      requestId,
      conversationId: convId,
      targetMessageId: msgId,
      status: "pending",
    },
  });

  try {
    const effective = resolveEffectiveSettings(agent);

    // 재생성 시 시스템 프롬프트 조립 — 매니저인 경우 도구 이름 필요
    let enabledToolNames: string[] = [];
    if (agent?.is_default) {
      try {
        const toolDefs = await resolveToolConfig(agent);
        enabledToolNames = toolDefs.toolDefinitions.map((t) => t.name);
      } catch (e) { logger.debug("No tools for regenerate agent", e); }
    }
    const baseSystemPrompt = await resolveSystemPrompt(agent, enabledToolNames, settings.companyName);

    const skillsSection = useSkillStore.getState().getSkillsPromptSection();
    const workspacePath = await resolveWorkspacePath(convId);

    // Retrieve BOOT.md only if regenerating the first assistant reply.
    let cachedBoot: string | undefined;
    const isFirstAssistantTurn = truncated.filter((m) => m.type === "user").length <= 1;
    if (isFirstAssistantTurn) {
      if (bootContentCache.has(convId)) {
        cachedBoot = bootContentCache.get(convId);
      } else if (agent) {
        try {
          const bootFromDisk = await readBootFile(agent.folder_name);
          if (bootFromDisk) {
            cachedBoot = bootFromDisk;
            bootContentCache.set(convId, bootFromDisk);
          }
        } catch (e) { logger.debug("BOOT.md read failed for regenerate", e); }
      }
    }

    // Use streamOneTurn which handles pre-compaction, context building, and streaming
    const done = await streamOneTurn({
      baseSystemPrompt,
      effective,
      requestId,
      msgId,
      skillsSection,
      workspacePath,
      bootContent: cachedBoot,
    });

    if (done.error) {
      if (done.error === "aborted") {
        handleStreamAbort(msgId);
      } else {
        throw new Error(done.error);
      }
    } else {
      const replyContent = done.full_content || i18n.t("common:noResponse");
      const reasoningContent = done.reasoning_content ?? undefined;

      await saveFinalResponse({
        convId,
        msgId,
        replyContent,
        reasoningContent,
      });

      useStreamStore.setState({ activeRun: null });
      useToolRunStore.getState().resetToolState();

      summary().maybeGenerateSummary(
        convId, baseSystemPrompt, msg().messages, () => conv().loadConversations(),
      );
    }
  } catch (error) {
    handleStreamError(error, msgId);
  }

  try {
    await conv().loadConversations();
  } catch (error) {
    logger.error("Failed to reload conversations after regenerate:", error);
  }
}

// ── Bootstrap message flow ─────────────────────────────

async function sendBootstrapMessage() {
  const inputValue = msg().inputValue;
  const messages = msg().messages;
  const { bootstrapApiHistory, bootstrapFolderName, bootstrapFilesWritten } = boot();

  const settings = useSettingsStore.getState();
  if (!bootstrapFolderName) return;

  const userMsg: ChatMessage = {
    id: `user-${Date.now()}`,
    type: "user",
    content: inputValue,
    status: "complete",
  };

  const { msgId, msg: pendingMsg } = createPendingMessage();
  useMessageStore.setState({ messages: [...messages, userMsg, pendingMsg], inputValue: "" });

  try {
    const result = await executeBootstrapTurn(
      bootstrapApiHistory,
      inputValue,
      bootstrapFolderName,
      settings.modelName,
    );

    const allFilesWritten = [...bootstrapFilesWritten];
    for (const f of result.filesWritten) {
      if (!allFilesWritten.includes(f)) allFilesWritten.push(f);
    }

    useBootstrapStore.setState({
      bootstrapApiHistory: result.apiMessages,
      bootstrapFilesWritten: allFilesWritten,
    });
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, msgId, {
        id: `resp-${Date.now()}`,
        content: result.responseText,
        status: "complete",
      }),
    });

    if (isBootstrapComplete(allFilesWritten)) {
      await completeBootstrap();
    }
  } catch (error) {
    logger.error("Bootstrap API Error:", error);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, msgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: toErrorMessage(error),
      }),
    });
  }
}

async function completeBootstrap() {
  const { bootstrapFolderName } = boot();
  if (!bootstrapFolderName) return;
  const theme = useSettingsStore.getState().uiTheme;

  // Transition to onboarding animation phase
  useBootstrapStore.setState({
    isBootstrapping: false,
    isOnboarding: true,
    bootstrapApiHistory: [],
    bootstrapFilesWritten: [],
    bootstrapFolderName: null,
  });
  useMessageStore.setState({ messages: [] });
  useSummaryStore.setState({ currentSummary: null, summaryUpToMessageId: null, summaryJobId: null });

  // Create agent in background while animation plays
  invalidatePersonaCache(bootstrapFolderName);

  const fallbackName = i18n.t("glossary:newAgent", { context: theme });
  let agentName: string;
  try {
    const identity = await cmds.readAgentFile(bootstrapFolderName, "IDENTITY.md");
    agentName = parseAgentName(identity, fallbackName);
  } catch (e) {
    logger.debug("IDENTITY.md read failed, using fallback name", e);
    agentName = fallbackName;
  }

  try {
    const agentResult = await cmds.createAgent({
      folder_name: bootstrapFolderName,
      name: agentName,
    });

    const agentStoreRef = useAgentStore.getState();
    await agentStoreRef.loadAgents();

    // Signal animation that backend work is done
    useBootstrapStore.setState({ onboardingAgentId: agentResult.id });
  } catch (error) {
    logger.error("Failed to complete bootstrap:", error);
    useBootstrapStore.setState({ isOnboarding: false, onboardingAgentId: null });
    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      type: "agent",
      content: i18n.t("glossary:bootstrapFailed", { error: String(error), context: theme }),
      status: "failed",
    };
    useMessageStore.setState({ messages: [errorMsg] });
  }
}
