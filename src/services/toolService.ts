import type { Attachment, ChatMessage, ToolCall } from "./types";
import * as cmds from "./tauriCommands";

/** Extract screenshot_path from browser tool result JSON and return as Attachment array. */
function extractBrowserAttachments(output: string): Attachment[] | undefined {
  try {
    const parsed = JSON.parse(output);
    if (parsed && typeof parsed.screenshot_path === "string" && parsed.screenshot_path) {
      return [{ type: "image", path: parsed.screenshot_path }];
    }
  } catch { /* not JSON or no screenshot */ }
  return undefined;
}

export async function executeToolCalls(
  toolCalls: ToolCall[],
  conversationId: string,
): Promise<ChatMessage[]> {
  const results: ChatMessage[] = [];
  for (const tc of toolCalls) {
    try {
      const result = await cmds.executeTool(tc.name, tc.arguments, conversationId);
      const isError = result.status === "error";
      const content = isError ? `Error: ${result.output}` : result.output;
      const msg: ChatMessage = {
        id: `tool-result-${Date.now()}-${tc.id}`,
        type: "tool",
        content,
        status: "complete",
        tool_call_id: tc.id,
        tool_name: tc.name,
      };
      if (!isError && tc.name.startsWith("browser_")) {
        msg.attachments = extractBrowserAttachments(result.output);
      }
      results.push(msg);
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
