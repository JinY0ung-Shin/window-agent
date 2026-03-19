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
import {
  readPersonaFiles,
  assembleManagerPrompt,
  getEffectiveSettings,
} from "../services/personaService";
import { buildConversationContext } from "../services/chatHelpers";
import { getEffectiveTools, toOpenAITools, getToolTier, type ToolDefinition } from "../services/toolRegistry";
import { readToolConfig } from "../services/nativeToolRegistry";
import { executeToolCalls } from "../services/toolService";
import { useToolRunStore } from "./toolRunStore";
import {
  CONVERSATION_TITLE_MAX_LENGTH,
  DEFAULT_SYSTEM_PROMPT,
  parseErrorMessage,
} from "../constants";
import { i18n } from "../i18n";
import type { ToolCall } from "../services/types";

// ── Stream event types ────────────────────────────────
type StreamChunkEvent = {
  request_id: string;
  delta: string;
  reasoning_delta: string | null;
};
type StreamDoneEvent = {
  request_id: string;
  full_content: string;
  reasoning_content: string | null;
  tool_calls:
    | { id: string; type: string; function: { name: string; arguments: string } }[]
    | null;
  error: string | null;
};
type TeamAllReportsPayload = {
  run_id: string;
  reports: { task_id: string; agent_id: string; summary: string; details: string | null }[];
};
type TeamRunCancelledPayload = { run_id: string };
type TeamSynthesisDonePayload = { run_id: string; request_id: string; error: string | null };

// ── Helpers ───────────────────────────────────────────

const msg = () => useMessageStore.getState();
const conv = () => useConversationStore.getState();
const stream = () => useStreamStore.getState();

function createPendingMessage(requestId?: string): { msgId: string; msg: ChatMessage } {
  const msgId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    msgId,
    msg: {
      id: msgId,
      type: "agent",
      content: i18n.t("common:loadingMessage"),
      status: "pending",
      requestId,
    },
  };
}

function updateMessageInList(
  messages: ChatMessage[],
  targetId: string,
  updates: Partial<ChatMessage>,
): ChatMessage[] {
  return messages.map((m) => (m.id === targetId ? { ...m, ...updates } : m));
}

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
      settings.setIsSettingsOpen(true);
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
      console.error("Failed to abort team run:", e);
    }
  },

  setupTeamListeners: async () => {
    const unlisteners: UnlistenFn[] = [];

    // ── team-agent-stream-chunk: route to per-agent message bubbles ──
    // The backend uses chat-stream-chunk with request_id = "team-{run_id}-{task_id}"
    // We intercept these and route them to the correct agent message bubble.
    unlisteners.push(
      await listen<StreamChunkEvent>("chat-stream-chunk", (event) => {
        const { request_id, delta } = event.payload;
        const mapping = agentStreamMap.get(request_id);
        if (!mapping) return; // Not a team stream event

        const { msgId } = mapping;
        // Use rAF batching: accumulate into the message
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
          // Don't delete from agentStreamMap — team-leader-synthesis-done handles it
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
          } catch {
            /* use empty */
          }
          const summary = reportArgs.summary ?? full_content;

          // Save the completed agent message
          const finalContent = full_content || summary;
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, msgId, {
              content: finalContent,
              status: "complete",
            }),
          });

          // Submit report to backend (fire-and-forget — backend emits team-all-reports-in when all done)
          teamCmds
            .handleTeamReport(runId, taskId, summary, reportArgs.details)
            .catch((e) => console.error("Failed to submit report:", e));
        } else {
          // Normal completion (no report tool) — treat content as implicit report
          const finalContent = full_content || i18n.t("common:noResponse");
          useMessageStore.setState({
            messages: updateMessageInList(msg().messages, msgId, {
              content: finalContent,
              status: "complete",
            }),
          });

          // Submit implicit report
          teamCmds
            .handleTeamReport(runId, taskId, finalContent)
            .catch((e) => console.error("Failed to submit implicit report:", e));
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
            .catch((e) => console.error("Failed to save agent message:", e));
        }

        agentStreamMap.delete(request_id);
      }),
    );

    // ── team-all-reports-in: create pending leader synthesis bubble ──
    // Backend handles synthesis LLM call; we just prepare the UI bubble and
    // register the synthesis request_id so chat-stream-chunk events route here.
    unlisteners.push(
      await listen<TeamAllReportsPayload>("team-all-reports-in", (event) => {
        const { run_id } = event.payload;

        const synthesisRequestId = `synthesis-${run_id}`;
        const { msgId: synthMsgId, msg: synthPending } = createPendingMessage(synthesisRequestId);

        // Resolve leader info from the active run
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

        // Register so chat-stream-chunk/done events route to this bubble
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
        const { run_id, request_id, error } = event.payload;
        const mapping = agentStreamMap.get(request_id);
        if (!mapping) return;

        if (!error) {
          // Content was already finalized by chat-stream-done; save to DB
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
              .catch((e) => console.error("Failed to save synthesis message:", e));
          }
        }
        // Error case already handled by chat-stream-done

        agentStreamMap.delete(request_id);

        // Mark run as done
        useTeamRunStore.getState().updateRunStatus(run_id, "done");
        teamCmds
          .updateTeamRunStatus(run_id, "done", new Date().toISOString())
          .catch(() => {
            /* non-fatal */
          });
        stream().removeRun(run_id);
        conv().loadConversations();
      }),
    );

    // ── team-run-cancelled: mark streaming messages as aborted ──
    unlisteners.push(
      await listen<TeamRunCancelledPayload>("team-run-cancelled", (event) => {
        const { run_id } = event.payload;

        // Mark all agent stream messages for this run as aborted
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

        // Clean up stream store
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
    console.error("No team selected for team message");
    return;
  }

  const agentStore = useAgentStore.getState();

  // Resolve team detail to get leader
  let teamDetail;
  try {
    teamDetail = await teamStore.getTeamDetail(teamId);
  } catch (e) {
    console.error("Failed to get team detail:", e);
    return;
  }

  const leaderAgentId = teamDetail.team.leader_agent_id;
  const leaderAgent = agentStore.agents.find((a) => a.id === leaderAgentId) ?? null;

  // Create or reuse conversation
  let convId = currentConversationId;

  if (!convId) {
    const initialTitle =
      inputValue.slice(0, CONVERSATION_TITLE_MAX_LENGTH) ||
      i18n.t("common:defaultConversationTitle");
    const newConv = await cmds.createTeamConversation(teamId, leaderAgentId, initialTitle);
    convId = newConv.id;
    useConversationStore.setState({ currentConversationId: convId });
  }

  // Save user message
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

  // Create pending leader message
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

  // Create a team run
  let teamRun;
  try {
    teamRun = await teamCmds.createTeamRun(teamId, convId, leaderAgentId);
    useTeamRunStore.getState().addRun(teamRun);
  } catch (e) {
    console.error("Failed to create team run:", e);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, leaderMsgId, {
        content: parseErrorMessage(e),
        status: "failed",
      }),
    });
    return;
  }

  // Track leader run in streamStore.runsById
  useStreamStore.getState().addRun(teamRun.id, {
    requestId: leaderRequestId,
    conversationId: convId,
    targetMessageId: leaderMsgId,
    status: "pending",
  });

  try {
    // Build leader system prompt
    const effective = leaderAgent
      ? getEffectiveSettings(leaderAgent)
      : {
          model: settings.modelName,
          temperature: null as number | null,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingBudget: settings.thinkingBudget,
        };

    // Load the leader's configured tools + delegate
    let toolDefinitions: ToolDefinition[] = [];
    let autoApproveEnabled = false;
    if (leaderAgent) {
      try {
        toolDefinitions = await getEffectiveTools(leaderAgent.folder_name);
      } catch { /* no tools */ }
      try {
        const tc = await readToolConfig(leaderAgent.folder_name);
        autoApproveEnabled = tc?.auto_approve ?? false;
      } catch { /* default false */ }
    }

    const enabledToolNames = [...toolDefinitions.map((t) => t.name), "delegate"];

    let baseSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    if (leaderAgent) {
      try {
        const files = await readPersonaFiles(leaderAgent.folder_name);
        // Leader uses manager prompt with agent list
        baseSystemPrompt = assembleManagerPrompt(
          files,
          agentStore.agents,
          settings.companyName,
          enabledToolNames,
        );
      } catch {
        // Fallback to default
      }
    }

    const MAX_LEADER_TOOL_ITERATIONS = 10;
    let iterationCount = 0;
    let currentRequestId = leaderRequestId;
    let currentMsgId = leaderMsgId;

    while (iterationCount <= MAX_LEADER_TOOL_ITERATIONS) {
      // Stream leader's response
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
        // Parse delegate arguments
        let delegateArgs: { agents?: string[]; task?: string; context?: string } = {};
        try {
          delegateArgs = JSON.parse(delegateCall.function.arguments);
        } catch {
          /* ignore */
        }

        const agentIds = delegateArgs.agents ?? [];
        const taskDescription = delegateArgs.task ?? inputValue;
        const taskContext = delegateArgs.context;

        // Save leader's response (with tool call info)
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

          // Store a temporary mapping — will be updated with real request_id after delegation
          // We use agentId as a temp key
          agentStreamMap.set(`temp-${teamRun.id}-${agentId}`, {
            agentId,
            taskId: "",
            msgId: agentMsgId,
            runId: teamRun.id,
          });
        }

        // Execute delegation — backend creates tasks and spawns parallel LLM streams
        try {
          const taskIds = await teamCmds.executeDelegation(
            convId,
            teamRun.id,
            agentIds,
            taskDescription,
            taskContext,
          );

          // Register tasks in teamRunStore for tracking
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

          // Update mappings with real request_ids (format: team-{run_id}-{task_id})
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

              // Update message with teamTaskId
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
          console.error("Delegation failed:", e);
          // Clean up temp mappings
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

        const parsedToolCalls: ToolCall[] = toolCalls.map((tc) => ({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        }));

        // Save leader's assistant message with tool calls
        const savedAssistant = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: replyContent,
          sender_agent_id: leaderAgentId,
          team_run_id: teamRun.id,
          tool_name: "tool_calls",
          tool_input: JSON.stringify(parsedToolCalls),
        });

        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, currentMsgId, {
            dbMessageId: savedAssistant.id,
            content: replyContent,
            tool_calls: parsedToolCalls,
            status: "complete",
          }),
        });

        // Classify tool calls by tier
        let savedToolMsgs: ChatMessage[] = [];
        const autoTools: ToolCall[] = [];
        const confirmTools: ToolCall[] = [];
        const denyTools: ToolCall[] = [];

        for (const tc of parsedToolCalls) {
          const tier = getToolTier(toolDefinitions, tc.name);
          if (tier === "deny") {
            denyTools.push(tc);
          } else if (tier === "confirm") {
            if (autoApproveEnabled) {
              autoTools.push(tc);
            } else {
              confirmTools.push(tc);
            }
          } else {
            autoTools.push(tc);
          }
        }

        // Execute denied tools
        for (const tc of denyTools) {
          const saved = await cmds.saveMessage({
            conversation_id: convId,
            role: "tool",
            content: "Tool denied by policy.",
            tool_call_id: tc.id,
            tool_name: tc.name,
          });
          savedToolMsgs.push({
            id: saved.id,
            type: "tool" as const,
            content: "Tool denied by policy.",
            status: "complete" as const,
            tool_call_id: tc.id,
            tool_name: tc.name,
          });
        }

        // Execute auto-approved tools
        if (autoTools.length > 0) {
          const autoResults = await executeToolCalls(autoTools, convId);
          for (const toolMsg of autoResults) {
            const saved = await cmds.saveMessage({
              conversation_id: convId,
              role: "tool",
              content: toolMsg.content,
              tool_call_id: toolMsg.tool_call_id,
              tool_name: toolMsg.tool_name,
            });
            savedToolMsgs.push({ ...toolMsg, id: saved.id, dbMessageId: saved.id });
          }
        }

        // Execute confirm-tier tools with user approval
        if (confirmTools.length > 0) {
          useToolRunStore.setState({ toolRunState: "tool_waiting", pendingToolCalls: confirmTools });
          const approved = await useToolRunStore.getState().waitForToolApproval();
          if (approved) {
            useToolRunStore.setState({ toolRunState: "tool_running" });
            const confirmResults = await executeToolCalls(confirmTools, convId);
            for (const toolMsg of confirmResults) {
              const saved = await cmds.saveMessage({
                conversation_id: convId,
                role: "tool",
                content: toolMsg.content,
                tool_call_id: toolMsg.tool_call_id,
                tool_name: toolMsg.tool_name,
              });
              savedToolMsgs.push({ ...toolMsg, id: saved.id, dbMessageId: saved.id });
            }
          } else {
            for (const tc of confirmTools) {
              const saved = await cmds.saveMessage({
                conversation_id: convId,
                role: "tool",
                content: "Tool call rejected by user.",
                tool_call_id: tc.id,
                tool_name: tc.name,
              });
              savedToolMsgs.push({
                id: saved.id,
                type: "tool" as const,
                content: "Tool call rejected by user.",
                status: "complete" as const,
                tool_call_id: tc.id,
                tool_name: tc.name,
              });
            }
          }
        }

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

        // Update stream tracking
        useStreamStore.getState().addRun(teamRun.id, {
          requestId: currentRequestId,
          conversationId: convId,
          targetMessageId: currentMsgId,
          status: "pending",
        });

        continue; // next iteration of tool loop
      } else {
        // Leader responded with normal text (no delegation, no tools)
        const finalContent = replyContent || i18n.t("common:noResponse");
        const savedLeader = await cmds.saveMessage({
          conversation_id: convId,
          role: "assistant",
          content: finalContent,
          sender_agent_id: leaderAgentId,
          team_run_id: teamRun.id,
        });

        useMessageStore.setState({
          messages: updateMessageInList(msg().messages, currentMsgId, {
            dbMessageId: savedLeader.id,
            content: finalContent,
            status: "complete",
          }),
        });

        // Mark run as done (no delegation needed)
        try {
          await teamCmds.updateTeamRunStatus(teamRun.id, "done", new Date().toISOString());
          useTeamRunStore.getState().updateRunStatus(teamRun.id, "done");
        } catch {
          /* non-fatal */
        }
        stream().removeRun(teamRun.id);
        break; // no more tools — exit loop
      }
    }
  } catch (error) {
    console.error("Team message error:", error);
    useMessageStore.setState({
      messages: updateMessageInList(msg().messages, leaderMsgId, {
        content: parseErrorMessage(error),
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    });
    stream().removeRun(teamRun.id);
  }

  await conv().loadConversations();
}

// ── Stream leader turn (reuses chatFlowStore pattern) ──

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
  });

  let pendingDelta = "";
  let rafId: number | null = null;

  const flushDelta = () => {
    if (!pendingDelta) return;
    const delta = pendingDelta;
    pendingDelta = "";

    useMessageStore.setState({
      messages: msg().messages.map((m: ChatMessage) =>
        m.id === msgId
          ? {
              ...m,
              content:
                m.content === i18n.t("common:loadingMessage") ? delta : m.content + delta,
              status: "streaming" as const,
            }
          : m,
      ),
    });
  };

  let doneResolve: (v: StreamDoneEvent) => void;
  const donePromise = new Promise<StreamDoneEvent>((r) => {
    doneResolve = r;
  });

  const unlistenChunk = await listen<StreamChunkEvent>("chat-stream-chunk", (event) => {
    if (event.payload.request_id !== requestId) return;
    pendingDelta += event.payload.delta;
    if (rafId === null) {
      rafId = requestAnimationFrame(() => {
        flushDelta();
        rafId = null;
      });
    }
  });

  const unlistenDone = await listen<StreamDoneEvent>("chat-stream-done", (event) => {
    if (event.payload.request_id !== requestId) return;
    doneResolve(event.payload);
  });

  try {
    await cmds.chatCompletionStream({
      messages: chatMessages as Record<string, unknown>[],
      system_prompt: systemPrompt,
      model: effective.model,
      temperature: effective.temperature,
      thinking_enabled: effective.thinkingEnabled,
      thinking_budget: effective.thinkingBudget,
      request_id: requestId,
      tools,
    });

    const done = await donePromise;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    flushDelta();
    return done;
  } finally {
    unlistenChunk();
    unlistenDone();
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }
}

