import { useSettingsStore } from "../stores/settingsStore";
import { getLabels, type Labels } from "../labels";

/**
 * React hook — convenience wrapper around getLabels().
 * Re-renders when uiTheme changes.
 */
export function useLabels(): Labels {
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  return getLabels(uiTheme);
}

/**
 * React hook — returns company name from settings.
 */
export function useCompanyName(): string {
  return useSettingsStore((s) => s.companyName);
}
