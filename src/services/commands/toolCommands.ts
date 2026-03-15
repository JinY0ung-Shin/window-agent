import { invoke } from "@tauri-apps/api/core";
import type { NativeToolDef } from "../types";

// ── Native Tool Registry ──

export async function getNativeTools(): Promise<NativeToolDef[]> {
  return invoke("get_native_tools");
}

export async function getDefaultToolConfig(): Promise<string> {
  return invoke("get_default_tool_config");
}

export async function readToolConfig(folderName: string): Promise<string> {
  return invoke("read_tool_config", { folderName });
}

export async function writeToolConfig(folderName: string, config: string): Promise<void> {
  return invoke("write_tool_config", { folderName, config });
}
