import type { ToolPermissionTier } from "./types";

export interface ToolDefinition {
  name: string;
  description: string;
  tier: ToolPermissionTier;
  parameters: Record<string, unknown>;
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

export { getEffectiveTools } from "./nativeToolRegistry";
