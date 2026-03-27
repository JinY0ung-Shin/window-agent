import * as cmds from "./tauriCommands";

// ── Browser domain approval (per conversation) ──

const browserApprovedDomains = new Map<string, Set<string>>();

/** Strict pattern for credential placeholders: {{credential:ID}} where ID is [A-Za-z0-9_-]+ */
const CREDENTIAL_PLACEHOLDER_RE = /\{\{credential:[A-Za-z0-9_-]+\}\}/;

/** Returns true if this tool call should NOT be auto-approved because
 *  it uses credentials (env vars for run_command, or placeholders for browser_type). */
export function isCredentialBearingTool(
  tc: { name: string; arguments?: string },
  agentHasCredentials: boolean,
): boolean {
  if (tc.name === "run_command") return agentHasCredentials;
  if (tc.name === "browser_type" && agentHasCredentials) {
    try {
      const args = JSON.parse(tc.arguments ?? "{}");
      return typeof args.text === "string" && CREDENTIAL_PLACEHOLDER_RE.test(args.text);
    } catch { /* ignore */ }
  }
  return false;
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
