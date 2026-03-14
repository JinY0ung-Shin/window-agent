import * as cmds from "./tauriCommands";

import { DEFAULT_AGENT_NAME } from "../constants";

/** The 4 core persona file names that must be written for bootstrap to complete. */
const REQUIRED_BOOTSTRAP_FILES = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"] as const;

/** OpenAI function-calling tool definitions for bootstrap. */
const BOOTSTRAP_TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write content to a persona file. Valid paths: IDENTITY.md, SOUL.md, USER.md, AGENTS.md",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File name (IDENTITY.md, SOUL.md, USER.md, or AGENTS.md)",
          },
          content: { type: "string", description: "File content in Markdown" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description:
        "Read content from a persona file. Valid paths: IDENTITY.md, SOUL.md, USER.md, AGENTS.md",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "File name (IDENTITY.md, SOUL.md, USER.md, or AGENTS.md)",
          },
        },
        required: ["path"],
      },
    },
  },
];

export interface BootstrapTurnResult {
  apiMessages: any[];
  responseText: string;
  filesWritten: string[];
}

/**
 * Execute one bootstrap turn:
 *   1. Append user message to history
 *   2. Call API with tools (via backend proxy)
 *   3. If the model returns tool_calls, execute them and loop
 *   4. Return when the model produces a text-only response
 */
export async function executeBootstrapTurn(
  apiMessages: any[],
  userMessage: string,
  folderName: string,
  model: string,
): Promise<BootstrapTurnResult> {
  const messages = [...apiMessages, { role: "user", content: userMessage }];
  const filesWritten: string[] = [];

  // Tool-call loop (max 5 iterations as safety net)
  for (let i = 0; i < 5; i++) {
    const response = await cmds.bootstrapCompletion({
      model,
      messages,
      tools: BOOTSTRAP_TOOLS,
    });

    if (!response || !response.message) {
      throw new Error("Bootstrap API returned an invalid response: missing message field");
    }

    const assistantMsg = response.message;
    messages.push(assistantMsg);

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      for (const tc of assistantMsg.tool_calls) {
        if (tc.type !== "function") continue;
        const toolFn = tc.function;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolFn.arguments);
        } catch (parseError) {
          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: `Error: failed to parse tool arguments as JSON: ${parseError}`,
          });
          continue;
        }
        let result: string;

        if (toolFn.name === "write_file") {
          const path = String(args.path ?? "");
          const content = String(args.content ?? "");
          try {
            await cmds.writeAgentFile(folderName, path, content);
            filesWritten.push(path);
            result = `Successfully wrote ${path}`;
          } catch (e) {
            result = `Error writing ${path}: ${e}`;
          }
        } else if (toolFn.name === "read_file") {
          const path = String(args.path ?? "");
          try {
            result = await cmds.readAgentFile(folderName, path);
          } catch {
            result = `File not found: ${path}`;
          }
        } else {
          result = `Unknown function: ${toolFn.name}`;
        }

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        });
      }
    } else {
      return {
        apiMessages: messages,
        responseText: assistantMsg.content || "",
        filesWritten,
      };
    }
  }

  const lastMsg = messages[messages.length - 1];
  return {
    apiMessages: messages,
    responseText:
      typeof lastMsg?.content === "string" ? lastMsg.content : "",
    filesWritten,
  };
}

/**
 * Parse agent name from IDENTITY.md content (first `# heading`).
 */
export function parseAgentName(identityContent: string): string {
  const match = identityContent.match(/^#\s+(.+)/m);
  return match?.[1]?.trim() || DEFAULT_AGENT_NAME;
}

/**
 * Check if all 4 persona files have been written.
 */
export function isBootstrapComplete(filesWritten: string[]): boolean {
  return REQUIRED_BOOTSTRAP_FILES.every((f) => filesWritten.includes(f));
}
