import { invoke } from "@tauri-apps/api/core";

export async function approveBrowserDomain(
  conversationId: string,
  domain: string,
): Promise<void> {
  return invoke("approve_browser_domain", { conversationId, domain });
}
