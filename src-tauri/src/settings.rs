//! Unified application settings — single source of truth for non-secret config.
//!
//! Follows the same persist-first pattern as [`crate::api::ApiState`]:
//! write to Tauri store → save → update in-memory → emit event.
//!
//! **Store file:** `app-settings.json`
//!
//! Settings that live elsewhere (and why):
//! - API key / base_url / no_proxy → `ApiState` + `api-config.json` (secret isolation)
//! - Ed25519 keypair → `NodeIdentity` + `relay-identity.json` (immutable identity)

use crate::error::AppError;
use crate::utils::config_helpers::read_env_non_empty;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::Emitter;
use tauri_plugin_store::StoreExt;

const STORE_APP: &str = "app-settings.json";
const STORE_RELAY: &str = "relay-settings.json";
const STORE_BROWSER: &str = "browser-config.json";

// ── Default values ───────────────────────────────────────

const DEFAULT_MODEL: &str = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_THINKING_BUDGET: u32 = 4096;
const DEFAULT_UI_THEME: &str = "org";
const DEFAULT_LOCALE: &str = "ko";
const DEFAULT_RELAY_URL: &str = "wss://relay.windowagent.io/ws";

// ── Core types ───────────────────────────────────────────

/// Managed state holding all non-secret application settings.
pub struct AppSettings {
    inner: Mutex<AppSettingsInner>,
}

/// The full settings snapshot. Returned by `get_app_settings` command.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettingsInner {
    // LLM
    pub model_name: String,
    pub thinking_enabled: bool,
    pub thinking_budget: u32,
    // Branding / UI
    pub ui_theme: String,
    pub company_name: String,
    pub branding_initialized: bool,
    pub locale: String,
    // Relay (persisted in relay-settings.json)
    pub network_enabled: bool,
    pub relay_url: String,
    pub allowed_tools: Vec<String>,
    pub discoverable: bool,
    pub directory_agent_name: String,
    pub directory_agent_description: String,
    // Browser (persisted in browser-config.json)
    pub browser_headless: bool,
    pub browser_proxy: String,
    pub browser_no_proxy: String,
}

impl Default for AppSettingsInner {
    fn default() -> Self {
        Self {
            model_name: DEFAULT_MODEL.to_string(),
            thinking_enabled: false,
            thinking_budget: DEFAULT_THINKING_BUDGET,
            ui_theme: DEFAULT_UI_THEME.to_string(),
            company_name: String::new(),
            branding_initialized: false,
            locale: DEFAULT_LOCALE.to_string(),
            network_enabled: false,
            relay_url: DEFAULT_RELAY_URL.to_string(),
            allowed_tools: Vec::new(),
            discoverable: true,
            directory_agent_name: String::new(),
            directory_agent_description: String::new(),
            browser_headless: false,
            browser_proxy: String::new(),
            browser_no_proxy: String::new(),
        }
    }
}

/// Partial update — every field is optional. `None` means "keep current value".
#[derive(Debug, Clone, Default, Deserialize)]
pub struct AppSettingsPatch {
    pub model_name: Option<String>,
    pub thinking_enabled: Option<bool>,
    pub thinking_budget: Option<u32>,
    pub ui_theme: Option<String>,
    pub company_name: Option<String>,
    pub branding_initialized: Option<bool>,
    pub locale: Option<String>,
    // Relay
    pub network_enabled: Option<bool>,
    pub relay_url: Option<String>,
    pub allowed_tools: Option<Vec<String>>,
    pub discoverable: Option<bool>,
    pub directory_agent_name: Option<String>,
    pub directory_agent_description: Option<String>,
    // Browser
    pub browser_headless: Option<bool>,
    pub browser_proxy: Option<String>,
    pub browser_no_proxy: Option<String>,
}

// ── AppSettings impl ─────────────────────────────────────

// ── Helpers ──────────────────────────────────────────────

fn read_str(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Option<String> {
    store.get(key).and_then(|v| v.as_str().map(String::from))
}
fn read_bool(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Option<bool> {
    store.get(key).and_then(|v| v.as_bool())
}
fn read_u32(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Option<u32> {
    store.get(key).and_then(|v| v.as_u64()).map(|n| n as u32)
}
fn read_string_vec(store: &tauri_plugin_store::Store<tauri::Wry>, key: &str) -> Option<Vec<String>> {
    store.get(key).and_then(|v| {
        v.as_array().map(|arr| {
            arr.iter().filter_map(|item| item.as_str().map(String::from)).collect()
        })
    })
}

/// Read settings from all store files with env-var overrides.
fn read_from_store(app: &tauri::AppHandle) -> AppSettingsInner {
    let mut s = AppSettingsInner::default();

    // ── app-settings.json ──
    if let Ok(store) = app.store(STORE_APP) {
        if let Some(v) = read_str(&store, "model_name").filter(|v| !v.is_empty()) {
            s.model_name = v;
        }
        if let Some(v) = read_bool(&store, "thinking_enabled") { s.thinking_enabled = v; }
        if let Some(v) = read_u32(&store, "thinking_budget") { s.thinking_budget = v; }
        if let Some(v) = read_str(&store, "ui_theme").filter(|v| !v.is_empty()) { s.ui_theme = v; }
        if let Some(v) = read_str(&store, "company_name") { s.company_name = v; }
        if let Some(v) = read_bool(&store, "branding_initialized") { s.branding_initialized = v; }
        if let Some(v) = read_str(&store, "locale").filter(|v| !v.is_empty()) { s.locale = v; }
    }

    // ── relay-settings.json ──
    if let Ok(store) = app.store(STORE_RELAY) {
        if let Some(v) = read_bool(&store, "network_enabled") { s.network_enabled = v; }
        if let Some(v) = read_str(&store, "relay_url").filter(|v| !v.is_empty()) { s.relay_url = v; }
        if let Some(v) = read_string_vec(&store, "allowed_tools") { s.allowed_tools = v; }
        if let Some(v) = read_bool(&store, "discoverable") { s.discoverable = v; }
        if let Some(v) = read_str(&store, "directory_agent_name") { s.directory_agent_name = v; }
        if let Some(v) = read_str(&store, "directory_agent_description") { s.directory_agent_description = v; }
    }

    // ── browser-config.json ──
    if let Ok(store) = app.store(STORE_BROWSER) {
        if let Some(v) = read_bool(&store, "headless") { s.browser_headless = v; }
        if let Some(v) = read_str(&store, "proxy_server") { s.browser_proxy = v.to_string(); }
        if let Some(v) = read_str(&store, "no_proxy") { s.browser_no_proxy = v; }
    }

    // Env var overrides (dev convenience)
    if let Some(m) = read_env_non_empty("OPENAI_MODEL") {
        s.model_name = m;
    }

    s
}

impl AppSettings {
    /// Load settings from store, with env-var overrides for dev convenience.
    /// Priority: env > store > default.
    pub fn load(app: &tauri::AppHandle) -> Self {
        Self {
            inner: Mutex::new(read_from_store(app)),
        }
    }

    /// Get a clone of the current settings.
    pub fn get(&self) -> AppSettingsInner {
        self.inner
            .lock()
            .expect("AppSettings lock poisoned")
            .clone()
    }

    /// Apply a partial update: persist first, then update in-memory, then emit event.
    /// Writes to the appropriate store file(s) based on which fields are set.
    /// The entire operation holds the mutex to prevent concurrent read-modify-write races.
    pub fn set(
        &self,
        patch: &AppSettingsPatch,
        app: &tauri::AppHandle,
    ) -> Result<(), AppError> {
        // Hold the lock for the entire read-modify-write cycle to prevent races.
        let mut guard = self.inner.lock()
            .map_err(|_| AppError::Lock("AppSettings lock poisoned".into()))?;

        let new = AppSettingsInner {
            model_name: patch.model_name.clone().unwrap_or_else(|| guard.model_name.clone()),
            thinking_enabled: patch.thinking_enabled.unwrap_or(guard.thinking_enabled),
            thinking_budget: patch.thinking_budget.unwrap_or(guard.thinking_budget),
            ui_theme: patch.ui_theme.clone().unwrap_or_else(|| guard.ui_theme.clone()),
            company_name: patch.company_name.clone().unwrap_or_else(|| guard.company_name.clone()),
            branding_initialized: patch.branding_initialized.unwrap_or(guard.branding_initialized),
            locale: patch.locale.clone().unwrap_or_else(|| guard.locale.clone()),
            network_enabled: patch.network_enabled.unwrap_or(guard.network_enabled),
            relay_url: patch.relay_url.clone().unwrap_or_else(|| guard.relay_url.clone()),
            allowed_tools: patch.allowed_tools.clone().unwrap_or_else(|| guard.allowed_tools.clone()),
            discoverable: patch.discoverable.unwrap_or(guard.discoverable),
            directory_agent_name: patch.directory_agent_name.clone().unwrap_or_else(|| guard.directory_agent_name.clone()),
            directory_agent_description: patch.directory_agent_description.clone().unwrap_or_else(|| guard.directory_agent_description.clone()),
            browser_headless: patch.browser_headless.unwrap_or(guard.browser_headless),
            browser_proxy: patch.browser_proxy.clone().unwrap_or_else(|| guard.browser_proxy.clone()),
            browser_no_proxy: patch.browser_no_proxy.clone().unwrap_or_else(|| guard.browser_no_proxy.clone()),
        };

        // Persist to the appropriate store files based on which fields changed.
        let has_app = patch.model_name.is_some() || patch.thinking_enabled.is_some()
            || patch.thinking_budget.is_some() || patch.ui_theme.is_some()
            || patch.company_name.is_some() || patch.branding_initialized.is_some()
            || patch.locale.is_some();
        let has_relay = patch.network_enabled.is_some() || patch.relay_url.is_some()
            || patch.allowed_tools.is_some() || patch.discoverable.is_some()
            || patch.directory_agent_name.is_some() || patch.directory_agent_description.is_some();
        let has_browser = patch.browser_headless.is_some() || patch.browser_proxy.is_some() || patch.browser_no_proxy.is_some();

        if has_app {
            let store = app.store(STORE_APP)
                .map_err(|e| AppError::Config(format!("Failed to open app settings store: {e}")))?;
            store.set("model_name", serde_json::json!(&new.model_name));
            store.set("thinking_enabled", serde_json::json!(new.thinking_enabled));
            store.set("thinking_budget", serde_json::json!(new.thinking_budget));
            store.set("ui_theme", serde_json::json!(&new.ui_theme));
            store.set("company_name", serde_json::json!(&new.company_name));
            store.set("branding_initialized", serde_json::json!(new.branding_initialized));
            store.set("locale", serde_json::json!(&new.locale));
            store.save().map_err(|e| AppError::Config(format!("Failed to persist app settings: {e}")))?;
        }

        if has_relay {
            let store = app.store(STORE_RELAY)
                .map_err(|e| AppError::Config(format!("Failed to open relay settings store: {e}")))?;
            store.set("network_enabled", serde_json::json!(new.network_enabled));
            store.set("relay_url", serde_json::json!(&new.relay_url));
            store.set("allowed_tools", serde_json::json!(&new.allowed_tools));
            store.set("discoverable", serde_json::json!(new.discoverable));
            store.set("directory_agent_name", serde_json::json!(&new.directory_agent_name));
            store.set("directory_agent_description", serde_json::json!(&new.directory_agent_description));
            store.save().map_err(|e| AppError::Config(format!("Failed to persist relay settings: {e}")))?;
        }

        if has_browser {
            let store = app.store(STORE_BROWSER)
                .map_err(|e| AppError::Config(format!("Failed to open browser settings store: {e}")))?;
            store.set("headless", serde_json::json!(new.browser_headless));
            store.set("proxy_server", serde_json::json!(&new.browser_proxy));
            store.set("no_proxy", serde_json::json!(&new.browser_no_proxy));
            store.save().map_err(|e| AppError::Config(format!("Failed to persist browser settings: {e}")))?;
        }

        // Persistence succeeded — update in-memory (still under lock)
        *guard = new.clone();
        drop(guard); // release lock before emitting event

        // Notify frontend
        let _ = app.emit("settings:changed", &new);

        Ok(())
    }

    /// Reload in-memory settings from the store file.
    fn reload_from_store(&self, app: &tauri::AppHandle) {
        if let Ok(mut inner) = self.inner.lock() {
            *inner = read_from_store(app);
        }
    }

    /// Migrate settings from frontend localStorage (one-time).
    /// Only writes keys that are NOT already present in the store.
    pub fn migrate_from_frontend(
        &self,
        values: &serde_json::Value,
        app: &tauri::AppHandle,
    ) -> Result<(), AppError> {
        let store = app
            .store(STORE_APP)
            .map_err(|e| AppError::Config(format!("Failed to open settings store: {e}")))?;

        // Check if migration already happened
        if store.get("_migrated").and_then(|v| v.as_bool()).unwrap_or(false) {
            return Ok(());
        }

        let key_map = [
            ("openai_model_name", "model_name"),
            ("thinking_enabled", "thinking_enabled"),
            ("thinking_budget", "thinking_budget"),
            ("ui_theme", "ui_theme"),
            ("company_name", "company_name"),
            ("branding_initialized", "branding_initialized"),
            ("locale", "locale"),
        ];

        let mut changed = false;
        for (ls_key, store_key) in &key_map {
            // Only write if the store doesn't already have this key
            if store.get(*store_key).is_some() {
                continue;
            }
            if let Some(val) = values.get(*ls_key) {
                // localStorage stores everything as strings; convert as needed
                match *store_key {
                    "thinking_enabled" | "branding_initialized" => {
                        let b = val.as_str().map(|s| s == "true")
                            .or_else(|| val.as_bool())
                            .unwrap_or(false);
                        store.set(*store_key, serde_json::json!(b));
                    }
                    "thinking_budget" => {
                        let n = val.as_str().and_then(|s| s.parse::<u32>().ok())
                            .or_else(|| val.as_u64().map(|n| n as u32))
                            .unwrap_or(DEFAULT_THINKING_BUDGET);
                        store.set(*store_key, serde_json::json!(n));
                    }
                    _ => {
                        let s = val.as_str().unwrap_or("").to_string();
                        if !s.is_empty() {
                            store.set(*store_key, serde_json::json!(s));
                        }
                    }
                }
                changed = true;
            }
        }

        store.set("_migrated", serde_json::json!(true));
        store.save()
            .map_err(|e| AppError::Config(format!("Failed to persist migrated settings: {e}")))?;

        if changed {
            // Reload in-memory from store values
            self.reload_from_store(app);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings_have_expected_values() {
        let s = AppSettingsInner::default();
        assert_eq!(s.model_name, DEFAULT_MODEL);
        assert!(!s.thinking_enabled);
        assert_eq!(s.thinking_budget, 4096);
        assert_eq!(s.ui_theme, "org");
        assert!(s.company_name.is_empty());
        assert!(!s.branding_initialized);
        assert_eq!(s.locale, "ko");
        // Relay defaults
        assert!(!s.network_enabled);
        assert_eq!(s.relay_url, DEFAULT_RELAY_URL);
        assert!(s.allowed_tools.is_empty());
        assert!(s.discoverable);
        // Browser defaults
        assert!(!s.browser_headless);
        assert!(s.browser_proxy.is_empty());
    }

    #[test]
    fn patch_none_fields_keep_defaults() {
        let current = AppSettingsInner::default();
        let patch = AppSettingsPatch::default();
        let merged = apply_patch(&current, &patch);
        assert_eq!(merged.model_name, DEFAULT_MODEL);
        assert_eq!(merged.locale, "ko");
        assert_eq!(merged.relay_url, DEFAULT_RELAY_URL);
        assert!(!merged.browser_headless);
    }

    #[test]
    fn patch_some_fields_override() {
        let current = AppSettingsInner::default();
        let patch = AppSettingsPatch {
            model_name: Some("gpt-5".into()),
            thinking_enabled: Some(true),
            company_name: Some("Acme".into()),
            locale: Some("en".into()),
            relay_url: Some("wss://custom.example.com/ws".into()),
            browser_headless: Some(true),
            ..Default::default()
        };
        let merged = apply_patch(&current, &patch);
        assert_eq!(merged.model_name, "gpt-5");
        assert!(merged.thinking_enabled);
        assert_eq!(merged.thinking_budget, 4096); // kept default
        assert_eq!(merged.company_name, "Acme");
        assert_eq!(merged.locale, "en");
        assert_eq!(merged.relay_url, "wss://custom.example.com/ws");
        assert!(merged.browser_headless);
    }

    /// Helper to apply a patch to settings (same logic as AppSettings::set).
    fn apply_patch(current: &AppSettingsInner, patch: &AppSettingsPatch) -> AppSettingsInner {
        AppSettingsInner {
            model_name: patch.model_name.clone().unwrap_or_else(|| current.model_name.clone()),
            thinking_enabled: patch.thinking_enabled.unwrap_or(current.thinking_enabled),
            thinking_budget: patch.thinking_budget.unwrap_or(current.thinking_budget),
            ui_theme: patch.ui_theme.clone().unwrap_or_else(|| current.ui_theme.clone()),
            company_name: patch.company_name.clone().unwrap_or_else(|| current.company_name.clone()),
            branding_initialized: patch.branding_initialized.unwrap_or(current.branding_initialized),
            locale: patch.locale.clone().unwrap_or_else(|| current.locale.clone()),
            network_enabled: patch.network_enabled.unwrap_or(current.network_enabled),
            relay_url: patch.relay_url.clone().unwrap_or_else(|| current.relay_url.clone()),
            allowed_tools: patch.allowed_tools.clone().unwrap_or_else(|| current.allowed_tools.clone()),
            discoverable: patch.discoverable.unwrap_or(current.discoverable),
            directory_agent_name: patch.directory_agent_name.clone().unwrap_or_else(|| current.directory_agent_name.clone()),
            directory_agent_description: patch.directory_agent_description.clone().unwrap_or_else(|| current.directory_agent_description.clone()),
            browser_headless: patch.browser_headless.unwrap_or(current.browser_headless),
            browser_proxy: patch.browser_proxy.clone().unwrap_or_else(|| current.browser_proxy.clone()),
            browser_no_proxy: patch.browser_no_proxy.clone().unwrap_or_else(|| current.browser_no_proxy.clone()),
        }
    }
}
