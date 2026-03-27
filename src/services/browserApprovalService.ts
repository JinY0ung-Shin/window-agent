import * as cmds from "./tauriCommands";

// ── Browser domain approval (per conversation) ──

const browserApprovedDomains = new Map<string, Set<string>>();

/** Returns true if this tool call should NOT be auto-approved because
 *  it will receive credential environment variables at execution time. */
export function isCredentialBearingTool(
  tc: { name: string },
  agentHasCredentials: boolean,
): boolean {
  if (tc.name !== "run_command") return false;
  return agentHasCredentials;
}

export function extractBrowserDomain(toolName: string, toolArgs: string): string | null {
  if (!toolName.startsWith("browser_")) return null;
  try {
    const args = JSON.parse(toolArgs);
    if (args.url) {
      const url = new URL(args.url);
      return url.hostname;
    }
  } catch { /* ignore */ }
  return null; // non-navigate browser tools don't change domain
}

export function isBrowserDomainApproved(conversationId: string, domain: string | null): boolean {
  if (!domain) return false;
  const approved = browserApprovedDomains.get(conversationId);
  return approved?.has(domain) ?? false;
}

export function approveBrowserDomain(conversationId: string, domain: string) {
  if (!browserApprovedDomains.has(conversationId)) {
    browserApprovedDomains.set(conversationId, new Set());
  }
  browserApprovedDomains.get(conversationId)!.add(domain);
  // Sync approval to backend so Rust security policy also allows this domain
  cmds.approveBrowserDomain(conversationId, domain).catch(() => {
    // Backend session may not exist yet; approval will apply on next tool call
  });
}

export function clearBrowserApprovals(conversationId: string) {
  browserApprovedDomains.delete(conversationId);
}
