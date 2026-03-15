import { invoke } from "@tauri-apps/api/core";

export interface BrowserArtifact {
  id: string;
  session_id: string;
  conversation_id: string;
  snapshot_full: string;
  ref_map_json: string;
  url: string;
  title: string;
  screenshot_path: string | null;
  created_at: string;
}

export async function approveBrowserDomain(
  conversationId: string,
  domain: string,
): Promise<void> {
  return invoke("approve_browser_domain", { conversationId, domain });
}

export async function getBrowserArtifact(id: string): Promise<BrowserArtifact> {
  return invoke("get_browser_artifact", { id });
}
