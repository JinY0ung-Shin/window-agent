import type { ChatMessage, ToolCall, ToolRunState } from "../../services/types";
import type { ToolCallStatus } from "./toolCallUtils";
import { classifyToolResultStatus } from "./toolCallUtils";

export interface ToolRunStep {
  toolCall: ToolCall;
  resultMessage?: ChatMessage;
  status: ToolCallStatus;
}

export interface ToolRunGroupRun {
  assistantMessage: ChatMessage;
  leadingContent: string;
  steps: ToolRunStep[];
}

export type RenderBlock =
  | { type: "message"; key: string; message: ChatMessage }
  | {
      type: "tool_run";
      key: string;
      assistantMessage: ChatMessage;
      leadingContent: string;
      steps: ToolRunStep[];
      isActiveRun: boolean;
    }
  | { type: "tool_run_group"; key: string; runs: ToolRunGroupRun[] }
  | { type: "orphan_tool_result"; key: string; message: ChatMessage };

function isToolRunMessage(message: ChatMessage): boolean {
  return message.type === "agent" && !!message.tool_calls && message.tool_calls.length > 0;
}

function isLiveToolState(toolRunState: ToolRunState): boolean {
  return toolRunState === "tool_pending" || toolRunState === "tool_waiting" || toolRunState === "tool_running";
}

function getStepStatus(params: {
  toolCallId: string;
  resultMessage?: ChatMessage;
  isActiveRun: boolean;
  pendingToolCallIds: Set<string>;
  toolRunState: ToolRunState;
}): ToolCallStatus {
  const { toolCallId, resultMessage, isActiveRun, pendingToolCallIds, toolRunState } = params;

  if (resultMessage?.content) {
    return classifyToolResultStatus(resultMessage.content);
  }

  if (isActiveRun) {
    if (toolRunState === "tool_waiting" && pendingToolCallIds.has(toolCallId)) {
      return "pending";
    }
    if (toolRunState === "tool_pending" && pendingToolCallIds.has(toolCallId)) {
      return "approved";
    }
    if (toolRunState === "tool_running") {
      return "running";
    }
  }

  return "incomplete";
}

export function buildChatRenderBlocks(
  messages: ChatMessage[],
  toolRunState: ToolRunState,
  pendingToolCalls: ToolCall[],
): RenderBlock[] {
  const blocks: RenderBlock[] = [];
  const pendingToolCallIds = new Set(pendingToolCalls.map((toolCall) => toolCall.id));
  let lastToolRunIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isToolRunMessage(messages[index])) {
      lastToolRunIndex = index;
      break;
    }
  }
  const hasLiveToolRun = isLiveToolState(toolRunState);

  for (let index = 0; index < messages.length; index++) {
    const message = messages[index];

    if (!isToolRunMessage(message)) {
      if (message.type === "tool") {
        blocks.push({ type: "orphan_tool_result", key: `orphan-${message.id}`, message });
      } else {
        blocks.push({ type: "message", key: message.id, message });
      }
      continue;
    }

    const toolCallIds = new Set(message.tool_calls!.map((toolCall) => toolCall.id));
    const resultByToolCallId = new Map<string, ChatMessage>();
    const orphanResults: ChatMessage[] = [];
    let scanIndex = index + 1;

    while (scanIndex < messages.length && messages[scanIndex].type === "tool") {
      const toolMessage = messages[scanIndex];
      const toolCallId = toolMessage.tool_call_id ?? "";

      if (toolCallId && toolCallIds.has(toolCallId) && !resultByToolCallId.has(toolCallId)) {
        resultByToolCallId.set(toolCallId, toolMessage);
      } else {
        orphanResults.push(toolMessage);
      }

      scanIndex++;
    }

    const isActiveRun = hasLiveToolRun && index === lastToolRunIndex;
    const steps: ToolRunStep[] = message.tool_calls!.map((toolCall) => {
      const resultMessage = resultByToolCallId.get(toolCall.id);
      return {
        toolCall,
        resultMessage,
        status: getStepStatus({
          toolCallId: toolCall.id,
          resultMessage,
          isActiveRun,
          pendingToolCallIds,
          toolRunState,
        }),
      };
    });

    blocks.push({
      type: "tool_run",
      key: `tool-run-${message.id}`,
      assistantMessage: message,
      leadingContent: message.content,
      steps,
      isActiveRun,
    });

    orphanResults.forEach((toolMessage) => {
      blocks.push({ type: "orphan_tool_result", key: `orphan-${toolMessage.id}`, message: toolMessage });
    });

    index = scanIndex - 1;
  }

  return blocks;
}

function isFullyCompletedRun(block: RenderBlock & { type: "tool_run" }): boolean {
  return !block.isActiveRun
    && block.steps.length > 0
    && block.steps.every((s) => s.resultMessage !== undefined);
}

/**
 * Post-process render blocks to group consecutive fully-completed tool_run
 * blocks into a single tool_run_group block (saves avatar + bubble overhead).
 */
export function groupConsecutiveToolRuns(blocks: RenderBlock[]): RenderBlock[] {
  const result: RenderBlock[] = [];
  let group: (RenderBlock & { type: "tool_run" })[] = [];

  const flushGroup = () => {
    if (group.length >= 2) {
      result.push({
        type: "tool_run_group",
        key: `trg-${group[0].key}`,
        runs: group.map((b) => ({
          assistantMessage: b.assistantMessage,
          leadingContent: b.leadingContent,
          steps: b.steps,
        })),
      });
    } else if (group.length === 1) {
      result.push(group[0]);
    }
    group = [];
  };

  for (const block of blocks) {
    if (block.type === "tool_run" && isFullyCompletedRun(block)) {
      group.push(block);
    } else {
      flushGroup();
      result.push(block);
    }
  }
  flushGroup();

  return result;
}
