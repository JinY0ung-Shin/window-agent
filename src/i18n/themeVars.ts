import type { i18n as I18nInstance } from "i18next";
import type { UITheme } from "../stores/settingsStore";

/** Glossary term keys that become interpolation variables across all namespaces */
const TERM_KEYS = ["agent", "agents"] as const;

/**
 * Build theme-dependent interpolation variables from glossary term_* keys
 * and inject them into i18n defaultVariables.
 *
 * Call after i18n.init(), and whenever uiTheme or language changes.
 */
export function syncThemeVars(i18n: I18nInstance, theme: UITheme): void {
  const t = i18n.getFixedT(i18n.language, "glossary");
  const vars: Record<string, string> = {};

  for (const key of TERM_KEYS) {
    const val = t(`term_${key}`, { context: theme });
    vars[`term_${key}`] = val;
    // Capitalized variant — useful for English sentence-start / labels
    vars[`term_${key}_cap`] = val.charAt(0).toUpperCase() + val.slice(1);
  }

  i18n.options.interpolation = {
    ...i18n.options.interpolation,
    defaultVariables: {
      ...i18n.options.interpolation?.defaultVariables,
      ...vars,
    },
  };
}
