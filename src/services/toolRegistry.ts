import type { ToolPermissionTier } from "./types";
import * as cmds from "./tauriCommands";

export interface ToolDefinition {
  name: string;
  description: string;
  tier: ToolPermissionTier;
  parameters: Record<string, any>;
}

/**
 * Parse a TOOLS.md file into tool definitions.
 *
 * Format:
 * ## tool_name
 * - description: Tool description text
 * - tier: auto | confirm | deny
 * - parameters:
 *   - param_name (type, required): description
 *   - param_name (type, optional): description
 */
export function parseToolsMd(content: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const sections = content.split(/^## /m).filter((s) => s.trim());

  for (const section of sections) {
    const lines = section.split("\n");
    const name = lines[0].trim();
    if (!name) continue;

    let description = "";
    let tier: ToolPermissionTier = "confirm";
    const properties: Record<string, any> = {};
    const required: string[] = [];
    let inParameters = false;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();

      if (line.startsWith("- description:")) {
        description = line.replace("- description:", "").trim();
        inParameters = false;
      } else if (line.startsWith("- tier:")) {
        const t = line.replace("- tier:", "").trim();
        if (t === "auto" || t === "confirm" || t === "deny") {
          tier = t;
        }
        inParameters = false;
      } else if (line.startsWith("- parameters:")) {
        inParameters = true;
      } else if (inParameters && line.startsWith("- ")) {
        // Parse: - param_name (type, required): description
        const paramMatch = line.match(
          /^- (\w+)\s*\((\w+)(?:,\s*(required|optional))?\)\s*:\s*(.*)$/,
        );
        if (paramMatch) {
          const [, pName, pType, pReq, pDesc] = paramMatch;
          properties[pName] = {
            type: pType,
            description: pDesc.trim(),
          };
          if (pReq !== "optional") {
            required.push(pName);
          }
        }
      }
    }

    tools.push({
      name,
      description,
      tier,
      parameters: {
        type: "object",
        properties,
        required: required.length > 0 ? required : undefined,
      },
    });
  }

  return tools;
}

/**
 * Load tool definitions for an agent by reading its TOOLS.md.
 * Returns empty array if TOOLS.md doesn't exist.
 */
export async function getToolsForAgent(
  folderName: string,
): Promise<ToolDefinition[]> {
  try {
    const content = await cmds.readAgentFile(folderName, "TOOLS.md");
    if (!content.trim()) return [];
    return parseToolsMd(content);
  } catch {
    return [];
  }
}

/**
 * Convert ToolDefinition[] to the OpenAI tools array format.
 */
export function toOpenAITools(definitions: ToolDefinition[]): object[] {
  return definitions.map((def) => ({
    type: "function",
    function: {
      name: def.name,
      description: def.description,
      parameters: def.parameters,
    },
  }));
}

/**
 * Look up the tier for a given tool name.
 */
export function getToolTier(
  definitions: ToolDefinition[],
  toolName: string,
): ToolPermissionTier {
  const def = definitions.find((d) => d.name === toolName);
  return def?.tier ?? "confirm";
}
