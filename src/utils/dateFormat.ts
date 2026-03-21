import { i18n, type Locale } from "../i18n";

// ── Intl locale mapping ──────────────────────────────
const INTL_LOCALE: Record<Locale, string> = {
  ko: "ko-KR",
  en: "en-US",
};

// ── Group label translations (via i18n) ──────────────
function getGroupLabels() {
  return {
    today: i18n.t("common:date.today"),
    yesterday: i18n.t("common:date.yesterday"),
    thisWeek: i18n.t("common:date.thisWeek"),
    unknown: i18n.t("common:date.other"),
  };
}

// ── Date group key/label ─────────────────────────────

export interface DateGroup {
  key: string;
  label: string;
}

/**
 * Returns a group key and localized label for a given date string.
 * Groups: today / yesterday / this-week / specific date / unknown.
 */
export function getDateGroup(dateStr: string, locale: Locale): DateGroup {
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return { key: "unknown", label: getGroupLabels().unknown };
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return { key: "today", label: getGroupLabels().today };
  if (diffDays === 1) return { key: "yesterday", label: getGroupLabels().yesterday };
  if (diffDays < 7) return { key: "this-week", label: getGroupLabels().thisWeek };

  // Use ISO date as stable key to avoid cross-year collisions
  const key = target.toISOString().slice(0, 10);
  const label = formatShortDate(date, locale);
  return { key, label };
}

// ── Formatting helpers ───────────────────────────────

/**
 * Short date label for group headers (e.g. "3월 19일" / "Mar 19").
 */
export function formatShortDate(date: Date, locale: Locale): string {
  const fmt = new Intl.DateTimeFormat(INTL_LOCALE[locale], {
    month: locale === "ko" ? "numeric" : "short",
    day: "numeric",
  });
  return fmt.format(date);
}

/**
 * Relative date string for display (e.g. "오늘", "어제", "3월 19일").
 * Same logic as getDateGroup but returns only the label string.
 */
export function formatRelativeDate(date: Date, locale: Locale): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.floor((today.getTime() - target.getTime()) / 86_400_000);

  if (diffDays === 0) return getGroupLabels().today;
  if (diffDays === 1) return getGroupLabels().yesterday;
  return formatShortDate(date, locale);
}

