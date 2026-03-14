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
  // Split on ## headers; first element is preamble (before any ## ), skip it
  const parts = content.split(/^## /m);
  const sections = parts.slice(1).filter((s) => s.trim());

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

/**
 * Serialize ToolDefinition[] back to TOOLS.md markdown format.
 * Inverse of parseToolsMd.
 */
export function serializeToolsMd(tools: ToolDefinition[]): string {
  if (tools.length === 0) return "";

  return tools
    .map((tool) => {
      const lines: string[] = [`## ${tool.name}`];
      lines.push(`- description: ${tool.description}`);
      lines.push(`- tier: ${tool.tier}`);

      const props = tool.parameters?.properties;
      const req: string[] = tool.parameters?.required ?? [];

      if (props && Object.keys(props).length > 0) {
        lines.push("- parameters:");
        for (const [pName, pDef] of Object.entries(props) as [string, { type?: string; description?: string }][]) {
          const pType = pDef.type ?? "string";
          const pReq = req.includes(pName) ? "required" : "optional";
          const pDesc = pDef.description ?? "";
          lines.push(`  - ${pName} (${pType}, ${pReq}): ${pDesc}`);
        }
      }

      return lines.join("\n");
    })
    .join("\n\n") + "\n";
}

/**
 * Normalize TOOLS.md content for round-trip comparison.
 * Strips whitespace, collapses blank lines, removes # Tools header.
 */
export function normalizeToolsMd(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.replace(/\t/g, "  ").trimEnd())
    .filter((line) => !/^#\s+Tools\s*$/i.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+/, "")
    .trim();
}

const VALID_TOOL_NAME_RE = /^\w+$/;

/**
 * Check if structured editing would lose content.
 * Returns true if the raw content can be safely round-tripped
 * and all tool/param names are compatible with the structured editor.
 */
export function canRoundTrip(rawContent: string): boolean {
  const trimmed = rawContent.trim();
  if (!trimmed) return true;
  const parsed = parseToolsMd(trimmed);

  // Check all tool names and param names are editor-compatible
  for (const tool of parsed) {
    if (!VALID_TOOL_NAME_RE.test(tool.name)) return false;
    const props = tool.parameters?.properties;
    if (props) {
      for (const pName of Object.keys(props)) {
        if (!VALID_TOOL_NAME_RE.test(pName)) return false;
      }
    }
  }

  const serialized = serializeToolsMd(parsed);
  return normalizeToolsMd(trimmed) === normalizeToolsMd(serialized);
}
