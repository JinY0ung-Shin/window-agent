import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { ChatMessage } from "../services/types";
import * as cmds from "../services/tauriCommands";
import * as teamCmds from "../services/commands/teamCommands";
import { useMessageStore } from "./messageStore";
import { useConversationStore } from "./conversationStore";
import { useStreamStore } from "./streamStore";
import { useTeamStore } from "./teamStore";
import { useTeamRunStore } from "./teamRunStore";
import { useAgentStore } from "./agentStore";
import { useSettingsStore } from "./settingsStore";
import { useNavigationStore } from "./navigationStore";
import { useToolRunStore } from "./toolRunStore";
import { useVaultStore } from "./vaultStore";
import { buildConversationContext } from "../services/chatHelpers";
import { toOpenAITools, type ToolDefinition } from "../services/toolRegistry";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  parseErrorMessage,
} from "../constants";
import { toErrorMessage } from "../utils/errorUtils";
import { i18n } from "../i18n";
import {
  type StreamChunkEvent,
  type StreamDoneEvent,
  msg, conv, stream,
  createPendingMessage,
  updateMessageInList,
  executeStreamCall,
} from "../services/streamHelpers";
import { logger } from "../services/logger";
import {
  resolveEffectiveSettings,
  resolveToolConfig,
  resolveManagerPrompt,
  processToolCalls,
  saveAssistantToolCallMessage,
  saveFinalResponse,
  parseRawToolCalls,
} from "./chatFlowBase";

// ── Team-specific event types ─────────────────────────
type TeamAllReportsPayload = {
  run_id: string;
  reports: { task_id: string; agent_id: string; summary: string; details: string | null }[];
};
type TeamRunCancelledPayload = { run_id: string };
type TeamSynthesisDonePayload = { run_id: string; request_id: string; error: string | null };

// ── Team-specific helpers ─────────────────────────────

function resolveAgentInfo(agentId: string): {
  name: string;
  avatar: string | null;
} {
  const agent = useAgentStore.getState().agents.find((a) => a.id === agentId);
  return {
    name: agent?.name ?? agentId,
    avatar: agent?.avatar ?? null,
  };
}

// Track requestId → { agentId, taskId, msgId } for routing stream events to agent bubbles
const agentStreamMap = new Map<
  string,
  { agentId: string; taskId: string; msgId: string; runId: string }
>();

// ── TeamChatFlowStore ─────────────────────────────────

interface TeamChatFlowState {
  sendTeamMessage: () => Promise<void>;
  abortCurrentRun: () => Promise<void>;
  setupTeamListeners: () => Promise<() => void>;
}

export const useTeamChatFlowStore = create<TeamChatFlowState>((_set, _get) => ({
  sendTeamMessage: async () => {
    const { inputValue } = msg();
    if (!inputValue.trim()) return;

    await useSettingsStore.getState().waitForEnv();
    const settings = useSettingsStore.getState();
    if (!settings.hasApiKey) {
      useNavigationStore.getState().setMainView("settings");
      return;
    }

    await sendTeamMessageFlow();
  },

  abortCurrentRun: async () => {
    // Find the active team run from teamRunStore
    const { activeRuns } = useTeamRunStore.getState();
    const runIds = Object.keys(activeRuns);
    if (runIds.length === 0) return;

    // Abort the most recent run
    const latestRunId = runIds[runIds.length - 1];
    try {
      await cmds.abortTeamRun(latestRunId);
    } catch (e) {
      logger.error("Failed to abort team run:", e);
    }
  },

  setupTeamListeners: async () => {
    const unlisteners: UnlistenFn[] = [];

    // ── team-agent-stream-chunk: route to per-agent message bubbles ──
    unlisteners.push(
      await listen<StreamChunkEvent>("chat-stream-chunk", (event) => {
        const { request_id, delta } = event.payload;
        const mapping = agentStreamMap.get(request_id);
        if (!mapping) return; // Not a team stream event

        const { msgId } = mapping;
        useMessageStore.setState({
          messages: msg().messages.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  content:
                    m.content === i18n.t("common:loadingMessage")
                      ? delta
                      : m.content + delta,
                  status: "streaming" as const,
                }
              : m,
          ),
        });

        // Update run status in streamStore
        const run = stream().runsById[mapping.runId];
        if (run && run.status !== "streaming") {
          useStreamStore.getState().addRun(mapping.runId, { ...run, status: "streaming" });
        }
      }),
    );

    // ── chat-stream-done for team agent streams ──
    unlisteners.push(
      await listen<StreamDoneEvent>("chat-stream-done", (event) => {
        const { request_id, full_content, tool_calls, error } = event.payload;
        const mapping = agentStreamMap.get(request_id);
        if (!mapping) return; // Not a team stream event

        const { msgId, agentId, taskId, runId } = mapping;

        // Synthesis streams — finalize content only; team-leader-synthesis-done handles cleanup
        if (taskId === "__synthesis__") {
          if (error) {
            useMessageStore.setState({
              messages: updateMessageInList(msg().messages, msgId, {
                content: error === "aborted" ? i18n.t("common:aborted") : error,
                status: error === "aborted" ? "aborted" : "failed",
              }),
            });
          } else {
            useMessageStore.setState({
              messages: updateMessageInList(msg().messages, msgId, {
                content: full_content || i18n.t("common:noResponse"),
                status: "complete",
              }),
            });
          }
          return;
        }

        if (error) {
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, msgId, {
              content: error === "aborted" ? i18n.t("common:aborted") : error,
              status: error === "aborted" ? "aborted" : "failed",
            }),
          });
          agentStreamMap.delete(request_id);
          return;
        }

        // Check if agent called the `report` tool
        const reportCall = tool_calls?.find((tc) => tc.function.name === "report");
        if (reportCall) {
          let reportArgs: { summary?: string; details?: string } = {};
          try {
            reportArgs = JSON.parse(reportCall.function.arguments);
          } catch (e) {
            logger.debug("Failed to parse report arguments", e);
          }
          const summaryText = reportArgs.summary ?? full_content;

          const finalContent = full_content || summaryText;
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, msgId, {
              content: finalContent,
              status: "complete",
            }),
          });

          teamCmds
            .handleTeamReport(runId, taskId, summaryText, reportArgs.details)
            .catch((e) => logger.error("Failed to submit report:", e));
        } else {
          // Normal completion (no report tool) — treat content as implicit report
          const finalContent = full_content || i18n.t("common:noResponse");
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, msgId, {
              content: finalContent,
              status: "complete",
            }),
          });

          teamCmds
            .handleTeamReport(runId, taskId, finalContent)
            .catch((e) => logger.error("Failed to submit implicit report:", e));
        }

        // Save agent message to DB
        const currentConvId = conv().currentConversationId;
        if (currentConvId) {
          const agentInfo = resolveAgentInfo(agentId);
          cmds
            .saveMessage({
              conversation_id: currentConvId,
              role: "assistant",
              content: full_content || "",
              sender_agent_id: agentId,
              team_run_id: runId,
              team_task_id: taskId,
            })
            .then((saved) => {
              useMessageStore.setState({
                messages: updateMessageInList(msg().messages, msgId, {
                  dbMessageId: saved.id,
                  senderAgentId: agentId,
                  senderAgentName: agentInfo.name,
                  senderAgentAvatar: agentInfo.avatar,
                }),
              });
            })
            .catch((e) => logger.error("Failed to save agent message:", e));
        }

        agentStreamMap.delete(request_id);
      }),
    );

    // ── team-all-reports-in: create pending leader synthesis bubble ──
    unlisteners.push(
      await listen<TeamAllReportsPayload>("team-all-reports-in", (event) => {
        const { run_id } = event.payload;

        const synthesisRequestId = `synthesis-${run_id}`;
        const { msgId: synthMsgId, msg: synthPending } = createPendingMessage(synthesisRequestId);

        const run = useTeamRunStore.getState().activeRuns[run_id];
        if (run) {
          const leaderInfo = resolveAgentInfo(run.leader_agent_id);
          synthPending.senderAgentId = run.leader_agent_id;
          synthPending.senderAgentName = leaderInfo.name;
          synthPending.senderAgentAvatar = leaderInfo.avatar;
        }
        synthPending.teamRunId = run_id;

        useMessageStore.setState({
          messages: [...msg().messages, synthPending],
        });

        agentStreamMap.set(synthesisRequestId, {
          agentId: run?.leader_agent_id ?? "",
          taskId: "__synthesis__",
          msgId: synthMsgId,
          runId: run_id,
        });
      }),
    );

    // ── team-leader-synthesis-done: finalize synthesis bubble ──
    unlisteners.push(
      await listen<TeamSynthesisDonePayload>("team-leader-synthesis-done", (event) => {
        const { run_id, request_id, error: synthError } = event.payload;
        const mapping = agentStreamMap.get(request_id);
        if (!mapping) return;

        if (!synthError) {
          const currentMsg = msg().messages.find((m) => m.id === mapping.msgId);
          const finalContent = currentMsg?.content || i18n.t("common:noResponse");
          const currentConvId = conv().currentConversationId;

          if (currentConvId) {
            const agentInfo = resolveAgentInfo(mapping.agentId);
            cmds
              .saveMessage({
                conversation_id: currentConvId,
                role: "assistant",
                content: finalContent,
                sender_agent_id: mapping.agentId,
                team_run_id: run_id,
              })
              .then((saved) => {
                useMessageStore.setState({
                  messages: updateMessageInList(msg().messages, mapping.msgId, {
                    dbMessageId: saved.id,
                    senderAgentId: mapping.agentId,
                    senderAgentName: agentInfo.name,
                    senderAgentAvatar: agentInfo.avatar,
                  }),
                });
              })
              .catch((e) => logger.error("Failed to save synthesis message:", e));
          }
        }

        agentStreamMap.delete(request_id);

        useTeamRunStore.getState().updateRunStatus(run_id, "completed");
        teamCmds
          .updateTeamRunStatus(run_id, "completed", new Date().toISOString())
          .catch((e) => logger.debug("Failed to persist team run status", e));
        stream().removeRun(run_id);
        conv().loadConversations();
      }),
    );

    // ── team-run-cancelled: mark streaming messages as aborted ──
    unlisteners.push(
      await listen<TeamRunCancelledPayload>("team-run-cancelled", (event) => {
        const { run_id } = event.payload;

        for (const [reqId, mapping] of agentStreamMap.entries()) {
          if (mapping.runId === run_id) {
            useMessageStore.setState({
              messages: updateMessageInList(msg().messages, mapping.msgId, {
                status: "aborted",
              }),
            });
            agentStreamMap.delete(reqId);
          }
        }

        stream().removeRun(run_id);
      }),
    );

    return () => {
      for (const unlisten of unlisteners) {
        unlisten();
      }
    };
  },
}));

// ── Team message flow ──────────────────────────────────

async function sendTeamMessageFlow() {
  const inputValue = msg().inputValue;
  const currentConversationId = conv().currentConversationId;
  const messages = msg().messages;
  const settings = useSettingsStore.getState();

  const teamStore = useTeamStore.getState();
  const teamId = teamStore.selectedTeamId;
  if (!teamId) {
    logger.error("No team selected for team message");
    return;
  }

  const agentStore = useAgentStore.getState();

  let teamDetail;
  try {
    teamDetail = await teamStore.getTeamDetail(teamId);
  } catch (e) {
    logger.error("Failed to get team detail:", e);
    return;
  }

  const leaderAgentId = teamDetail.team.leader_agent_id;
  const leaderAgent = agentStore.agents.find((a) => a.id === leaderAgentId) ?? null;

  let convId = currentConversationId;

  if (!convId) {
    const initialTitle =
      inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
      i18n.t("common:defaultConversationTitle");
    const newConv = await cmds.createTeamConversation(teamId, leaderAgentId, initialTitle);
    convId = newConv.id;
    useConversationStore.setState({ currentConversationId: convId });
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

  const leaderRequestId = `req-team-leader-${Date.now()}`;
  const { msgId: leaderMsgId, msg: leaderPending } = createPendingMessage(leaderRequestId);

  if (leaderAgent) {
    const info = resolveAgentInfo(leaderAgentId);
    leaderPending.senderAgentId = leaderAgentId;
    leaderPending.senderAgentName = info.name;
    leaderPending.senderAgentAvatar = info.avatar;
  }

  useMessageStore.setState({
    messages: [...messages, userMsg, leaderPending],
    inputValue: "",
  });

  let teamRun;
  try {
    teamRun = await teamCmds.createTeamRun(teamId, convId, leaderAgentId);
    useTeamRunStore.getState().addRun(teamRun);
  } catch (e) {
    logger.error("Failed to create team run:", e);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, leaderMsgId, {
        content: parseErrorMessage(e),
        status: "failed",
      }),
    });
    return;
  }

  useStreamStore.getState().addRun(teamRun.id, {
    requestId: leaderRequestId,
    conversationId: convId,
    targetMessageId: leaderMsgId,
    status: "pending",
  });

  try {
    const effective = resolveEffectiveSettings(leaderAgent);
    const { toolDefinitions, autoApproveEnabled } = await resolveToolConfig(leaderAgent);
    const enabledToolNames = [...toolDefinitions.map((t) => t.name), "delegate"];
    const baseSystemPrompt = await resolveManagerPrompt(leaderAgent, enabledToolNames, settings.companyName);

    const saveExtras = { sender_agent_id: leaderAgentId, team_run_id: teamRun.id };

    const MAX_LEADER_TOOL_ITERATIONS = 10;
    let iterationCount = 0;
    let currentRequestId = leaderRequestId;
    let currentMsgId = leaderMsgId;

    while (iterationCount <= MAX_LEADER_TOOL_ITERATIONS) {
      const done = await streamLeaderTurn({
        baseSystemPrompt,
        effective,
        requestId: currentRequestId,
        msgId: currentMsgId,
        convId,
        toolDefinitions,
      });

      if (done.error) {
        if (done.error === "aborted") {
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, currentMsgId, { status: "aborted" }),
          });
        } else {
          throw new Error(done.error);
        }
        stream().removeRun(teamRun.id);
        return;
      }

      const replyContent = done.full_content || "";
      const toolCalls = done.tool_calls;

      // Check if leader called the delegate tool
      const delegateCall = toolCalls?.find((tc) => tc.function.name === "delegate");

      if (delegateCall) {
        let delegateArgs: { agents?: string[]; task?: string; context?: string } = {};
        try {
          delegateArgs = JSON.parse(delegateCall.function.arguments);
        } catch (e) {
          logger.debug("Failed to parse delegate arguments", e);
        }

        const agentIds = delegateArgs.agents ?? [];
        const taskDescription = delegateArgs.task ?? inputValue;
        const taskContext = delegateArgs.context;

        const savedLeader = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: replyContent,
          sender_agent_id: leaderAgentId,
          team_run_id: teamRun.id,
          tool_name: "tool_calls",
          tool_input: JSON.stringify([
            {
              id: delegateCall.id,
              name: delegateCall.function.name,
              arguments: delegateCall.function.arguments,
            },
          ]),
        });

        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, currentMsgId, {
            dbMessageId: savedLeader.id,
            content: replyContent || i18n.t("common:loadingMessage"),
            status: "complete",
          }),
        });

        // Create per-agent pending message bubbles BEFORE triggering delegation
        for (const agentId of agentIds) {
          const info = resolveAgentInfo(agentId);
          const { msgId: agentMsgId, msg: agentPending } = createPendingMessage();

          agentPending.senderAgentId = agentId;
          agentPending.senderAgentName = info.name;
          agentPending.senderAgentAvatar = info.avatar;
          agentPending.teamRunId = teamRun.id;

          useMessageStore.setState({
            messages: [...msg().messages, agentPending],
          });

          agentStreamMap.set(`temp-${teamRun.id}-${agentId}`, {
            agentId,
            taskId: "",
            msgId: agentMsgId,
            runId: teamRun.id,
          });
        }

        // Execute delegation
        try {
          const taskIds = await teamCmds.executeDelegation(
            convId,
            teamRun.id,
            agentIds,
            taskDescription,
            taskContext,
          );

          for (let i = 0; i < agentIds.length && i < taskIds.length; i++) {
            useTeamRunStore.getState().addTask({
              id: taskIds[i],
              run_id: teamRun.id,
              agent_id: agentIds[i],
              request_id: null,
              task_description: taskDescription,
              status: "queued",
              parent_message_id: null,
              result_summary: null,
              started_at: null,
              finished_at: null,
            });
          }

          // Update mappings with real request_ids
          for (let i = 0; i < agentIds.length && i < taskIds.length; i++) {
            const agentId = agentIds[i];
            const taskId = taskIds[i];
            const realRequestId = `team-${teamRun.id}-${taskId}`;
            const tempKey = `temp-${teamRun.id}-${agentId}`;
            const existing = agentStreamMap.get(tempKey);

            if (existing) {
              agentStreamMap.delete(tempKey);
              agentStreamMap.set(realRequestId, {
                ...existing,
                taskId,
              });

              useMessageStore.setState({
                messages: updateMessageInList(msg().messages, existing.msgId, {
                  teamTaskId: taskId,
                  teamRunId: teamRun.id,
                  requestId: realRequestId,
                }),
              });
            }
          }
        } catch (e) {
          logger.error("Delegation failed:", e);
          for (const agentId of agentIds) {
            const tempKey = `temp-${teamRun.id}-${agentId}`;
            const existing = agentStreamMap.get(tempKey);
            if (existing) {
              useMessageStore.setState({
                messages: updateMessageInList(msg().messages, existing.msgId, {
                  content: parseErrorMessage(e),
                  status: "failed",
                }),
              });
              agentStreamMap.delete(tempKey);
            }
          }
          stream().removeRun(teamRun.id);
        }
        break; // delegation triggered — exit tool loop
      } else if (toolCalls && toolCalls.length > 0) {
        // Leader used non-delegate tools — execute them and continue the loop
        iterationCount++;
        if (iterationCount > MAX_LEADER_TOOL_ITERATIONS) {
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, currentMsgId, {
              content: replyContent || i18n.t("common:noResponse"),
              status: "failed",
            }),
          });
          stream().removeRun(teamRun.id);
          break;
        }

        const parsedToolCalls = parseRawToolCalls(toolCalls);

        await saveAssistantToolCallMessage({
          convId,
          msgId: currentMsgId,
          replyContent,
          parsedToolCalls,
          saveExtras,
        });

        const savedToolMsgs = await processToolCalls(parsedToolCalls, {
          convId,
          toolDefinitions,
          autoApproveEnabled,
        });

        useToolRunStore.getState().resetToolState();

        // Create next pending message for continued loop
        currentRequestId = `req-team-leader-${Date.now()}`;
        const { msgId: nextMsgId, msg: nextPending } = createPendingMessage(currentRequestId);
        currentMsgId = nextMsgId;

        if (leaderAgent) {
          const info = resolveAgentInfo(leaderAgentId);
          nextPending.senderAgentId = leaderAgentId;
          nextPending.senderAgentName = info.name;
          nextPending.senderAgentAvatar = info.avatar;
        }

        useMessageStore.setState({
          messages: [...msg().messages, ...savedToolMsgs, nextPending],
        });

        useStreamStore.getState().addRun(teamRun.id, {
          requestId: currentRequestId,
          conversationId: convId,
          targetMessageId: currentMsgId,
          status: "pending",
        });

        continue;
      } else {
        // Leader responded with normal text (no delegation, no tools)
        await saveFinalResponse({
          convId,
          msgId: currentMsgId,
          replyContent,
          saveExtras,
        });

        try {
          await teamCmds.updateTeamRunStatus(teamRun.id, "completed", new Date().toISOString());
          useTeamRunStore.getState().updateRunStatus(teamRun.id, "completed");
        } catch (e) {
          logger.debug("Failed to persist team run completed status", e);
        }
        stream().removeRun(teamRun.id);
        break;
      }
    }
  } catch (error) {
    logger.error("Team message error:", error);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, leaderMsgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: toErrorMessage(error),
      }),
    });
    stream().removeRun(teamRun.id);
  }

  await conv().loadConversations();
}

// ── Stream leader turn ──────────────────────────────────

async function streamLeaderTurn(params: {
  baseSystemPrompt: string;
  effective: {
    model: string;
    temperature: number | null;
    thinkingEnabled: boolean;
    thinkingBudget: number | null;
  };
  requestId: string;
  msgId: string;
  convId: string;
  toolDefinitions: ToolDefinition[];
}): Promise<StreamDoneEvent> {
  const { baseSystemPrompt, effective, requestId, msgId, toolDefinitions } = params;

  // Build tools: leader's configured tools + delegate orchestration tool
  const delegateTool = {
    type: "function",
    function: {
      name: "delegate",
      description: "Delegate tasks to team members for parallel execution",
      parameters: {
        type: "object",
        properties: {
          agents: {
            type: "array",
            items: { type: "string" },
            description: "Agent IDs to delegate to",
          },
          task: {
            type: "string",
            description: "Task description for the agents",
          },
          context: {
            type: "string",
            description: "Additional context for the agents",
          },
        },
        required: ["agents", "task"],
      },
    },
  };

  const tools = [
    ...toOpenAITools(toolDefinitions),
    delegateTool,
  ];

  const { systemPrompt, apiMessages: chatMessages } = buildConversationContext({
    messages: msg().messages,
    summary: null,
    baseSystemPrompt,
    vaultNotes: useVaultStore.getState().notes,
    consolidatedMemory: conv().consolidatedMemory,
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
    tools,
  });
}
