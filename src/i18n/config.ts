import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { syncThemeVars } from "./themeVars";
import type { UITheme } from "../stores/settingsStore";

// ── Eagerly import all namespace resources ──
import koCommon from "./locales/ko/common.json";
import koGlossary from "./locales/ko/glossary.json";
import koSettings from "./locales/ko/settings.json";
import koOnboarding from "./locales/ko/onboarding.json";
import koAgent from "./locales/ko/agent.json";
import koChat from "./locales/ko/chat.json";
import koNetwork from "./locales/ko/network.json";
import koVault from "./locales/ko/vault.json";
import koPrompts from "./locales/ko/prompts.json";
import koTeam from "./locales/ko/team.json";
import koCron from "./locales/ko/cron.json";
import koNotification from "./locales/ko/notification.json";

import enCommon from "./locales/en/common.json";
import enGlossary from "./locales/en/glossary.json";
import enSettings from "./locales/en/settings.json";
import enOnboarding from "./locales/en/onboarding.json";
import enAgent from "./locales/en/agent.json";
import enChat from "./locales/en/chat.json";
import enNetwork from "./locales/en/network.json";
import enVault from "./locales/en/vault.json";
import enPrompts from "./locales/en/prompts.json";
import enTeam from "./locales/en/team.json";
import enCron from "./locales/en/cron.json";
import enNotification from "./locales/en/notification.json";

export const SUPPORTED_LOCALES = ["ko", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const LS_LOCALE = "locale";

const resources = {
  ko: {
    common: koCommon,
    glossary: koGlossary,
    settings: koSettings,
    onboarding: koOnboarding,
    agent: koAgent,
    chat: koChat,
    network: koNetwork,
    vault: koVault,
    prompts: koPrompts,
    team: koTeam,
    cron: koCron,
    notification: koNotification,
  },
  en: {
    common: enCommon,
    glossary: enGlossary,
    settings: enSettings,
    onboarding: enOnboarding,
    agent: enAgent,
    chat: enChat,
    network: enNetwork,
    vault: enVault,
    prompts: enPrompts,
    team: enTeam,
    cron: enCron,
    notification: enNotification,
  },
};

i18n.use(initReactI18next).init({
  resources,
  lng: localStorage.getItem(LS_LOCALE) || "ko",
  fallbackLng: "ko",
  ns: [
    "common",
    "glossary",
    "settings",
    "onboarding",
    "agent",
    "chat",
    "network",
    "vault",
    "prompts",
    "team",
    "cron",
    "notification",
  ],
  defaultNS: "common",
  interpolation: {
    escapeValue: false,
    format: (value: string, format?: string, lng?: string) => {
      if (!format || !lng?.startsWith("ko")) return value;
      const particles: Record<string, [string, string]> = {
        "이/가": ["이", "가"],
        "을/를": ["을", "를"],
        "은/는": ["은", "는"],
        "과/와": ["과", "와"],
        "으로/로": ["으로", "로"],
      };
      const pair = particles[format.trim()];
      if (!pair) return value;
      const code = value.charCodeAt(value.length - 1);
      // Korean syllable block: U+AC00 – U+D7A3
      if (code >= 0xac00 && code <= 0xd7a3) {
        return value + ((code - 0xac00) % 28 !== 0 ? pair[0] : pair[1]);
      }
      // Non-Korean character — default to vowel-ending form
      return value + pair[1];
    },
  },
  returnNull: false,
  initImmediate: false,
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, ns, key) => {
        console.warn(`[i18n] Missing key: ${ns}:${key}`);
      }
    : undefined,
});

// Seed theme-dependent interpolation variables from stored preference
const storedTheme = (localStorage.getItem("ui_theme") || "org") as UITheme;
syncThemeVars(i18n, storedTheme);

export default i18n;
