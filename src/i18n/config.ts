import i18n from "i18next";
import { initReactI18next } from "react-i18next";

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
  ],
  defaultNS: "common",
  interpolation: { escapeValue: false },
  returnNull: false,
  initImmediate: false,
  missingKeyHandler: import.meta.env.DEV
    ? (_lngs, ns, key) => {
        console.warn(`[i18n] Missing key: ${ns}:${key}`);
      }
    : undefined,
});

export default i18n;
