import type { ToolCall, ToolCallStatus, BrowserResult } from "../../services/types";
import { i18n } from "../../i18n";

// Re-export for backward compatibility
export type { ToolCallStatus, BrowserResult };

const SUMMARY_TRUNCATE = 80;
const PREVIEW_TRUNCATE = 120;

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function firstNonEmptyLine(value: string): string {
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ?? value.trim();
}

export function formatArgsSummary(args: string): string {
  const parsed = parseJsonObject(args);
  if (!parsed) {
    return truncate(args, SUMMARY_TRUNCATE);
  }

  return Object.entries(parsed)
    .map(([key, rawValue]) => {
      const value = typeof rawValue === "string"
        ? truncate(rawValue, 60)
        : JSON.stringify(rawValue);
      return `${key}: ${value}`;
    })
    .join(", ");
}

export function isBrowserTool(toolName: string): boolean {
  return toolName.startsWith("browser_");
}

export function parseBrowserResult(output: string): BrowserResult | null {
  const parsed = parseJsonObject(output);
  if (!parsed || parsed.success === undefined) return null;

  return {
    url: typeof parsed.url === "string" ? parsed.url : undefined,
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    snapshot: typeof parsed.snapshot === "string" ? parsed.snapshot : undefined,
    elementCount: typeof parsed.element_count === "number" ? parsed.element_count : undefined,
    artifact_id: typeof parsed.artifact_id === "string" ? parsed.artifact_id : undefined,
    screenshot_path: typeof parsed.screenshot_path === "string" ? parsed.screenshot_path : undefined,
  };
}

export function getWriteFilePreview(args: string): string | null {
  const parsed = parseJsonObject(args);
  if (!parsed || typeof parsed.content !== "string") return null;

  const lines = parsed.content.split("\n");
  return lines.slice(0, 20).join("\n") + (lines.length > 20 ? "\n..." : "");
}

export function classifyToolResultStatus(result: string): Extract<ToolCallStatus, "executed" | "denied" | "error"> {
  if (result.startsWith("Error:")) return "error";
  if (result.startsWith("Tool denied") || result.startsWith("Tool call rejected")) return "denied";
  return "executed";
}

export function getToolStatusLabel(status: ToolCallStatus): string {
  switch (status) {
    case "pending":
      return i18n.t("chat:tool.status.pending");
    case "approved":
      return i18n.t("chat:tool.status.approved");
    case "running":
      return i18n.t("chat:tool.status.running");
    case "executed":
      return i18n.t("chat:tool.status.done");
    case "denied":
      return i18n.t("chat:tool.status.rejected");
    case "error":
      return i18n.t("chat:tool.status.error");
    case "incomplete":
      return i18n.t("chat:tool.status.incomplete");
  }
}

export function getToolStatusTone(status: ToolCallStatus): ToolCallStatus {
  return status === "incomplete" ? "approved" : status;
}

function extractPreferredArgValue(toolCall: Pick<ToolCall, "arguments">): string | null {
  const parsed = parseJsonObject(toolCall.arguments);
  if (!parsed) return null;

  const preferredKeys = ["url", "path", "command", "cmd", "query", "q", "location", "ticker"];
  for (const key of preferredKeys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

export function getToolOutcomePreview(
  toolCall: Pick<ToolCall, "name" | "arguments">,
  result?: string,
  status?: ToolCallStatus,
): string {
  if (result && (status === "error" || status === "denied")) {
    return truncate(firstNonEmptyLine(result), PREVIEW_TRUNCATE);
  }

  if (result && isBrowserTool(toolCall.name)) {
    const browserResult = parseBrowserResult(result);
    if (browserResult?.title && browserResult.url) {
      return truncate(`${browserResult.title} · ${browserResult.url}`, PREVIEW_TRUNCATE);
    }
    if (browserResult?.url) {
      return truncate(browserResult.url, PREVIEW_TRUNCATE);
    }
    if (browserResult?.elementCount !== undefined) {
      return i18n.t("chat:tool.browser.snapshot", { count: browserResult.elementCount });
    }
    if (browserResult?.screenshot_path) {
      return i18n.t("chat:tool.browser.screenshot");
    }
  }

  if (result) {
    return truncate(firstNonEmptyLine(result), PREVIEW_TRUNCATE);
  }

  const preferredArg = extractPreferredArgValue(toolCall);
  if (preferredArg) {
    return truncate(preferredArg, PREVIEW_TRUNCATE);
  }

  const argsSummary = formatArgsSummary(toolCall.arguments);
  if (argsSummary) {
    return truncate(argsSummary, PREVIEW_TRUNCATE);
  }

  return i18n.t("chat:tool.preparing", { name: toolCall.name });
}
