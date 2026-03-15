import type { ToolConfig, NativeToolDef } from "./types";
import type { ToolDefinition } from "./toolRegistry";
import * as cmds from "./tauriCommands";

// Cache native tools (they don't change at runtime)
let nativeToolsCache: NativeToolDef[] | null = null;

export async function getNativeTools(): Promise<NativeToolDef[]> {
  if (nativeToolsCache) return nativeToolsCache;
  nativeToolsCache = await cmds.getNativeTools();
  return nativeToolsCache;
}

export async function getDefaultToolConfig(): Promise<ToolConfig> {
  const json = await cmds.getDefaultToolConfig();
  return JSON.parse(json);
}

export async function readToolConfig(folderName: string): Promise<ToolConfig | null> {
  try {
    const json = await cmds.readToolConfig(folderName);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export async function writeToolConfig(folderName: string, config: ToolConfig): Promise<void> {
  await cmds.writeToolConfig(folderName, JSON.stringify(config, null, 2));
}

export async function getEffectiveTools(folderName: string): Promise<ToolDefinition[]> {
  const config = await readToolConfig(folderName);
  if (!config) return []; // no config = no tools (backward compat)

  const nativeTools = await getNativeTools();
  const result: ToolDefinition[] = [];

  for (const tool of nativeTools) {
    const entry = config.native[tool.name];
    if (!entry || !entry.enabled) continue;

    result.push({
      name: tool.name,
      description: tool.description,
      tier: entry.tier,
      parameters: tool.parameters,
    });
  }

  return result;
}
