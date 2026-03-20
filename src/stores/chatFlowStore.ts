import { create } from "zustand";
import type { Agent, ChatMessage, Conversation, SkillMetadata, ToolCall } from "../services/types";
import * as cmds from "../services/tauriCommands";
import { useSettingsStore } from "./settingsStore";
import { useAgentStore } from "./agentStore";
import { useMemoryStore } from "./memoryStore";
import { useVaultStore } from "./vaultStore";
import { useSkillStore } from "./skillStore";
import { useBootstrapStore } from "./bootstrapStore";
import { useToolRunStore } from "./toolRunStore";
import { useConversationStore } from "./conversationStore";
import { useMessageStore } from "./messageStore";
import { useStreamStore } from "./streamStore";
import { useSummaryStore } from "./summaryStore";
import { resetChatContext } from "./resetHelper";
import { buildConversationContext } from "../services/chatHelpers";
import {
  readPersonaFiles,
  readBootFile,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
  invalidatePersonaCache,
} from "../services/personaService";
import {
  executeBootstrapTurn,
  parseAgentName,
  isBootstrapComplete,
} from "../services/bootstrapService";
import { getEffectiveTools, toOpenAITools, type ToolDefinition } from "../services/toolRegistry";
import { readToolConfig } from "../services/nativeToolRegistry";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  DEFAULT_SYSTEM_PROMPT,
  parseErrorMessage,
} from "../constants";
import { i18n } from "../i18n";
import { emitLifecycleEvent, onLifecycleEvent } from "../services/lifecycleEvents";
import { shouldFlush, preCompactFlush } from "../services/preCompactService";
import { estimateTokens } from "../services/tokenEstimator";
import {
  type StreamDoneEvent,
  MAX_TOOL_ITERATIONS,
  msg, conv, stream, boot, summary,
  createPendingMessage,
  updateMessageInList,
  executeStreamCall,
  classifyToolCalls,
  executeToolPipeline,
} from "../services/streamHelpers";
import {
  extractBrowserDomain,
  approveBrowserDomain,
} from "../services/browserApprovalService";
import { logger } from "../services/logger";

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
      settings.setIsSettingsOpen(true);
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

// ── Stream one turn ─────────────────────────────────────

async function streamOneTurn(
  params: {
    baseSystemPrompt: string;
    effective: { model: string; temperature: number | null; thinkingEnabled: boolean; thinkingBudget: number | null };
    requestId: string;
    msgId: string;
    tools?: object[];
    skillsSection?: string;
    workspacePath?: string;
    bootContent?: string | null;
  },
): Promise<StreamDoneEvent> {
  const { baseSystemPrompt, effective, requestId, msgId, tools, skillsSection, workspacePath, bootContent } = params;

  // Pre-compaction check: flush if approaching context limit
  const currentMessages = msg().messages;
  const consolidatedMem = conv().consolidatedMemory;
  const isLearning = conv().getCurrentLearningMode();
  const vaultNotes = useVaultStore.getState().notes;
  const memNotes = useMemoryStore.getState().notes;
  const notesTokens = vaultNotes.length > 0
    ? Math.min(vaultNotes.reduce((s, n) => s + estimateTokens(n.title + (n.bodyPreview ?? "")) + 4, 0), isLearning ? 1500 : 500)
    : Math.min(memNotes.reduce((s, n) => s + estimateTokens(n.title + n.content) + 4, 0), isLearning ? 1500 : 500);
  const systemOverhead =
    estimateTokens(baseSystemPrompt) +
    (skillsSection ? estimateTokens(skillsSection) : 0) +
    (bootContent ? estimateTokens(bootContent) : 0) +
    (consolidatedMem ? estimateTokens(consolidatedMem) : 0) +
    (consolidatedMem && isLearning ? Math.min(notesTokens, 700) :
     !consolidatedMem ? notesTokens : 0) +
    (workspacePath ? 200 : 0) +
    (isLearning ? 300 : 0) +
    500;
  const totalTokenEstimate = systemOverhead + currentMessages.reduce(
    (sum: number, m: ChatMessage) => sum + estimateTokens(m.content) + 4,
    0,
  );
  const currentConvId = conv().currentConversationId;
  if (shouldFlush(totalTokenEstimate, effective.model) && currentConvId) {
    const convObj = conv().conversations.find((c: Conversation) => c.id === currentConvId);
    const flushAgentId = convObj?.agent_id;
    if (flushAgentId) {
      await preCompactFlush(currentConvId, flushAgentId, effective.model, totalTokenEstimate);
    }
  }

  const learningMode = conv().getCurrentLearningMode();
  const consolidatedMemory = conv().consolidatedMemory;
  const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
    messages: msg().messages,
    summary: summary().currentSummary,
    baseSystemPrompt,
    skillsSection,
    bootContent,
    memoryNotes: useMemoryStore.getState().notes,
    vaultNotes: useVaultStore.getState().notes,
    workspacePath,
    learningMode,
    consolidatedMemory,
  });

  return executeStreamCall({
    requestId,
    msgId,
    messages: chatMessages as Record<string, unknown>[],
    systemPrompt,
    model: effective.model,
    temperature: effective.temperature,
    thinkingEnabled: effective.thinkingEnabled,
    thinkingBudget: effective.thinkingBudget,
    tools: tools ?? null,
  });
}

// ── Normal message flow ────────────────────────────────

async function sendNormalMessage() {
  const inputValue = msg().inputValue;
  const currentConversationId = conv().currentConversationId;
  const messages = msg().messages;
  const conversations = conv().conversations;
  const settings = useSettingsStore.getState();

  const agentStore = useAgentStore.getState();
  let agentId: string | null = null;
  let agent = null;

  if (currentConversationId) {
    const convObj = conversations.find((c: Conversation) => c.id === currentConversationId);
    agentId = convObj?.agent_id ?? null;
  } else {
    agentId = agentStore.selectedAgentId;
  }

  if (agentId) {
    agent = agentStore.agents.find((a: Agent) => a.id === agentId) ?? null;
  }

  if (agent && useSkillStore.getState().availableSkills.length === 0) {
    await useSkillStore.getState().loadSkills(agent.folder_name);
  }

  const isNewConversation = !currentConversationId;
  let convId = currentConversationId;
  let initialTitle: string | null = null;
  if (!convId) {
    if (!agentId) {
      logger.error("No agent selected for new conversation");
      return;
    }
    initialTitle =
      inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
      i18n.t("common:defaultConversationTitle");
    const newConv = await cmds.createConversation(agentId, initialTitle);
    convId = newConv.id;
    useConversationStore.setState({ currentConversationId: convId });

    // Emit lifecycle events for the new session
    emitLifecycleEvent({ type: "session:start", conversationId: convId, agentId });
    if (agent) {
      emitLifecycleEvent({ type: "agent:boot", agentId, folderName: agent.folder_name });
    }

    // Propagate draft learning mode to the new conversation
    const { draftLearningMode } = conv();
    if (draftLearningMode) {
      await cmds.setLearningMode(convId, true);
      useConversationStore.setState({ currentLearningMode: true, draftLearningMode: false });
    }

    const skillNames = useSkillStore.getState().activeSkillNames;
    if (skillNames.length > 0) {
      await cmds.updateConversationSkills(convId, skillNames);
    }
  }

  // Load BOOT.md for new conversations (cached for regenerate)
  let bootContent: string | null | undefined;
  if (isNewConversation && agent) {
    bootContent = await readBootFile(agent.folder_name);
    if (bootContent && convId) {
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

  let currentRequestId = `req-${Date.now()}`;
  const { msgId: firstMsgId, msg: pendingMsg } = createPendingMessage(currentRequestId);
  let currentMsgId = firstMsgId;

  useMessageStore.setState({
    messages: [...messages, userMsg, pendingMsg],
    inputValue: "",
  });
  useStreamStore.setState({
    activeRun: {
      requestId: currentRequestId,
      conversationId: convId,
      targetMessageId: currentMsgId,
      status: "pending",
    },
  });

  try {
    const effective = agent
      ? getEffectiveSettings(agent)
      : {
          model: settings.modelName,
          temperature: null as number | null,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingBudget: settings.thinkingBudget,
        };

    let toolDefinitions: ToolDefinition[] = [];
    let autoApproveEnabled = false;
    if (agent) {
      try {
        toolDefinitions = await getEffectiveTools(agent.folder_name);
      } catch (e) { logger.debug("No tools for agent", e); }
      try {
        const tc = await readToolConfig(agent.folder_name);
        autoApproveEnabled = tc?.auto_approve ?? false;
      } catch (e) { logger.debug("No tool config, using defaults", e); }
    }
    const openAITools = toolDefinitions.length > 0 ? toOpenAITools(toolDefinitions) : undefined;

    let baseSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        if (agent.is_default) {
          const enabledToolNames = toolDefinitions.map((t) => t.name);
          baseSystemPrompt = assembleManagerPrompt(
            files,
            agentStore.agents,
            settings.companyName,
            enabledToolNames,
          );
        } else {
          baseSystemPrompt = assembleSystemPrompt(files);
        }
      } catch (e) {
        logger.debug("Persona read failed, using default prompt", e);
      }
    }

    const skillsSection = useSkillStore.getState().getSkillsPromptSection();

    // Resolve workspace path for file tool scoping + prompt injection
    let workspacePath: string | undefined;
    try {
      workspacePath = await cmds.getWorkspacePath(convId);
    } catch (e) { logger.debug("Workspace path unavailable", e); }

    let iterationCount = 0;

    while (iterationCount <= MAX_TOOL_ITERATIONS) {
      const done = await streamOneTurn({
        baseSystemPrompt,
        effective,
        requestId: currentRequestId,
        msgId: currentMsgId,
        tools: openAITools,
        skillsSection,
        workspacePath,
        bootContent,
      });

      if (done.error) {
        if (done.error === "aborted") {
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, currentMsgId, { status: "aborted" }),
          });
          useStreamStore.setState({ activeRun: null });
          useToolRunStore.getState().resetToolState();
          break;
        }
        throw new Error(done.error);
      }

      const replyContent = done.full_content || "";
      const reasoningContent = done.reasoning_content ?? undefined;
      const toolCalls = done.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        const finalContent = replyContent || i18n.t("common:noResponse");
        const savedAssistant = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: finalContent,
        });

        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, currentMsgId, {
            dbMessageId: savedAssistant.id,
            content: finalContent,
            reasoningContent,
            status: "complete",
          }),
        });
        useStreamStore.setState({ activeRun: null });
        useToolRunStore.getState().resetToolState();

        summary().maybeGenerateSummary(
          convId, baseSystemPrompt, msg().messages, () => conv().loadConversations(),
        );
        break;
      }

      iterationCount++;
      if (iterationCount > MAX_TOOL_ITERATIONS) {
        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, currentMsgId, {
            content: replyContent || i18n.t("agent:tools.maxIterations"),
            status: "failed",
          }),
        });
        useStreamStore.setState({ activeRun: null });
        useToolRunStore.getState().resetToolState();
        break;
      }

      const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      }));

      const savedAssistant = await cmds.saveMessage({
        conversation_id: convId,
        role: "assistant",
        content: replyContent,
        tool_name: "tool_calls",
        tool_input: JSON.stringify(parsedToolCalls),
      });

      useMessageStore.setState({
        messages: updateMessageInList(msg().messages, currentMsgId, {
          dbMessageId: savedAssistant.id,
          content: replyContent,
          reasoningContent,
          tool_calls: parsedToolCalls,
          status: "complete",
        }),
      });

      const classification = classifyToolCalls(parsedToolCalls, toolDefinitions, {
        workspacePath,
        convId,
        autoApproveEnabled,
      });

      const savedToolMsgs = await executeToolPipeline(classification, convId, {
        iterationCount,
        onConfirmApproved: (tools) => {
          // Record approved browser domains for this conversation
          for (const tc of tools) {
            const domain = extractBrowserDomain(tc.name, tc.arguments);
            if (domain) approveBrowserDomain(convId, domain);
          }
        },
      });

      // Refresh stores based on tool call scopes after execution
      const agentIdForRefresh = useAgentStore.getState().selectedAgentId;
      if (agentIdForRefresh) {
        const hasVaultChange = parsedToolCalls.some((tc) => {
          if (tc.name !== "write_file" && tc.name !== "delete_file") return false;
          try { return JSON.parse(tc.arguments).scope === "vault"; } catch { return false; }
        });
        const hasPersonaChange = parsedToolCalls.some((tc) => {
          if (tc.name !== "write_file" && tc.name !== "delete_file") return false;
          try { return JSON.parse(tc.arguments).scope === "persona"; } catch { return false; }
        });
        if (hasVaultChange) {
          await useVaultStore.getState().loadNotes(agentIdForRefresh);
        }
        if (hasPersonaChange) {
          const agent = useAgentStore.getState().agents.find((a) => a.id === agentIdForRefresh);
          if (agent) invalidatePersonaCache(agent.folder_name);
        }
      }

      currentRequestId = `req-${Date.now()}`;
      const { msgId: nextMsgId, msg: nextPending } = createPendingMessage(currentRequestId);
      currentMsgId = nextMsgId;

      useMessageStore.setState({
        messages: [...msg().messages, ...savedToolMsgs, nextPending],
      });
      useToolRunStore.setState({ toolRunState: "continuing" });
      useStreamStore.setState({
        activeRun: {
          requestId: currentRequestId,
          conversationId: convId,
          targetMessageId: currentMsgId,
          status: "pending",
        },
      });
    }
  } catch (error) {
    logger.error("API Error:", error);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, currentMsgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    useStreamStore.setState({ activeRun: null });
    useToolRunStore.getState().resetToolState();
  }

  await conv().loadConversations();
}

// ── Regenerate stream flow ──────────────────────────────

async function regenerateStream(
  convId: string,
  truncated: ChatMessage[],
  _lastUserContent: string,
) {
  const settings = useSettingsStore.getState();
  const agentStore = useAgentStore.getState();
  const conversations = conv().conversations;

  const convObj = conversations.find((c: Conversation) => c.id === convId);
  const agentId = convObj?.agent_id ?? null;
  const agent = agentId
    ? agentStore.agents.find((a: Agent) => a.id === agentId) ?? null
    : null;

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
    const effective = agent
      ? getEffectiveSettings(agent)
      : {
          model: settings.modelName,
          temperature: null as number | null,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingBudget: settings.thinkingBudget,
        };

    let baseSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (agent) {
      try {
        const files = await readPersonaFiles(agent.folder_name);
        if (agent.is_default) {
          let enabledToolNames: string[] = [];
          try {
            const toolDefs = await getEffectiveTools(agent.folder_name);
            enabledToolNames = toolDefs.map((t) => t.name);
          } catch (e) { logger.debug("No tools for regenerate agent", e); }
          baseSystemPrompt = assembleManagerPrompt(
            files,
            agentStore.agents,
            settings.companyName,
            enabledToolNames,
          );
        } else {
          baseSystemPrompt = assembleSystemPrompt(files);
        }
      } catch (e) {
        logger.debug("Persona read failed during regenerate, using default", e);
      }
    }

    const skillsSection = useSkillStore.getState().getSkillsPromptSection();

    // Resolve workspace path for prompt injection
    let workspacePath: string | undefined;
    try {
      workspacePath = await cmds.getWorkspacePath(convId);
    } catch (e) { logger.debug("Workspace path unavailable for regenerate", e); }

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
        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, msgId, { status: "aborted" }),
        });
        useStreamStore.setState({ activeRun: null });
      } else {
        throw new Error(done.error);
      }
    } else {
      const replyContent = done.full_content || i18n.t("common:noResponse");
      const reasoningContent = done.reasoning_content ?? undefined;

      const savedAssistant = await cmds.saveMessage({
        conversation_id: convId,
        role: "assistant",
        content: replyContent,
      });

      useMessageStore.setState({
        messages: updateMessageInList(msg().messages, msgId, {
          dbMessageId: savedAssistant.id,
          content: replyContent,
          reasoningContent,
          status: "complete",
        }),
      });
      useStreamStore.setState({ activeRun: null });

      summary().maybeGenerateSummary(
        convId, baseSystemPrompt, msg().messages, () => conv().loadConversations(),
      );
    }
  } catch (error) {
    logger.error("Regenerate Error:", error);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, msgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    useStreamStore.setState({ activeRun: null });
  }

  await conv().loadConversations();
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
        error: error instanceof Error ? error.message : String(error),
      }),
    });
  }
}

async function completeBootstrap() {
  const { bootstrapFolderName } = boot();
  if (!bootstrapFolderName) return;
  const theme = useSettingsStore.getState().uiTheme;

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

    useBootstrapStore.getState().resetBootstrap();
    useMessageStore.setState({ messages: [] });
    useSummaryStore.setState({ currentSummary: null, summaryUpToMessageId: null, summaryJobId: null });

    const agentStoreRef = useAgentStore.getState();
    await agentStoreRef.loadAgents();
    agentStoreRef.selectAgent(agentResult.id);
  } catch (error) {
    logger.error("Failed to complete bootstrap:", error);
    const errorMsg: ChatMessage = {
      id: `error-${Date.now()}`,
      type: "agent",
      content: i18n.t("glossary:bootstrapFailed", { error: String(error), context: theme }),
      status: "failed",
    };
    useMessageStore.setState({ messages: [...msg().messages, errorMsg] });
  }
}
