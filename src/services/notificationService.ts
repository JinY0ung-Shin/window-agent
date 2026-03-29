/**
 * System notification service.
 *
 * Uses the Web Notification API (works in Tauri 2.0 WebView).
 * Only sends notifications when the app window is not focused.
 */

import { i18n } from "../i18n";

// ── Focus tracking ───────────────────────────────────

let windowFocused = document.hasFocus();

window.addEventListener("focus", () => { windowFocused = true; });
window.addEventListener("blur", () => { windowFocused = false; });

export function isWindowFocused(): boolean {
  return windowFocused;
}

// ── Settings (localStorage-backed) ───────────────────

const LS_NOTIFICATIONS_ENABLED = "notifications_enabled";

export function getNotificationsEnabled(): boolean {
  const stored = localStorage.getItem(LS_NOTIFICATIONS_ENABLED);
  // Default: enabled
  return stored === null ? true : stored === "true";
}

export function setNotificationsEnabled(enabled: boolean): void {
  localStorage.setItem(LS_NOTIFICATIONS_ENABLED, String(enabled));
}

// ── Permission ───────────────────────────────────────

async function ensurePermission(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  return result === "granted";
}

// ── Core send ────────────────────────────────────────

interface NotifyOptions {
  title: string;
  body?: string;
  /** If true, send even when focused (default: false) */
  force?: boolean;
}

async function send(opts: NotifyOptions): Promise<void> {
  if (!getNotificationsEnabled()) return;
  if (!opts.force && windowFocused) return;
  if (!(await ensurePermission())) return;

  new Notification(opts.title, {
    body: opts.body,
    icon: "/icons/128x128.png",
  });
}

// ── Typed notification helpers ───────────────────────

/** Chat response finished (DM) */
export function notifyChatDone(agentName?: string): void {
  const t = i18n.t.bind(i18n);
  const name = agentName || t("notification:defaultAgent", { ns: "notification" });
  send({
    title: t("notification:chatDone.title", { ns: "notification" }),
    body: t("notification:chatDone.body", { ns: "notification", agent: name }),
  });
}

/** Network (relay) message received */
export function notifyNetworkMessage(peerName?: string): void {
  const t = i18n.t.bind(i18n);
  send({
    title: t("notification:networkMessage.title", { ns: "notification" }),
    body: peerName
      ? t("notification:networkMessage.bodyWithName", { ns: "notification", name: peerName })
      : t("notification:networkMessage.body", { ns: "notification" }),
  });
}

/** Team run completed */
export function notifyTeamDone(teamName?: string): void {
  const t = i18n.t.bind(i18n);
  send({
    title: t("notification:teamDone.title", { ns: "notification" }),
    body: teamName
      ? t("notification:teamDone.bodyWithName", { ns: "notification", team: teamName })
      : t("notification:teamDone.body", { ns: "notification" }),
  });
}

/** Request permission proactively (e.g. on settings toggle) */
export async function requestNotificationPermission(): Promise<boolean> {
  return ensurePermission();
}
