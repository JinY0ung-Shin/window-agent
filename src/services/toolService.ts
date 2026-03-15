import type { ChatMessage, ToolCall } from "./types";
import * as cmds from "./tauriCommands";

export async function executeToolCalls(
  toolCalls: ToolCall[],
  conversationId: string,
): Promise<ChatMessage[]> {
  const results: ChatMessage[] = [];
  for (const tc of toolCalls) {
    try {
      const result = await cmds.executeTool(tc.name, tc.arguments, conversationId);
      results.push({
        id: `tool-result-${Date.now()}-${tc.id}`,
        type: "tool",
        content: result.output,
        status: "complete",
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    } catch (error) {
      results.push({
        id: `tool-error-${Date.now()}-${tc.id}`,
        type: "tool",
        content: `Error: ${error instanceof Error ? error.message : String(error)}`,
        status: "complete",
        tool_call_id: tc.id,
        tool_name: tc.name,
      });
    }
  }
  return results;
}
