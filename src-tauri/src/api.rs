use crate::error::AppError;
use crate::utils::config_helpers::read_env_non_empty;
use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;
use tauri_plugin_store::StoreExt;
use tokio::sync::Mutex as TokioMutex;

/// App-level API configuration state.
/// The API key never leaves the backend process.
/// Persisted to a Tauri store file in app data dir (convenience, not encrypted).
/// For stronger at-rest protection, migrate to OS keychain in the future.
pub struct ApiState {
    inner: Mutex<ApiConfig>,
    /// HTTP client — wrapped in Mutex so it can be rebuilt when proxy settings change.
    client: Mutex<reqwest::Client>,
}

#[derive(Clone)]
struct ApiConfig {
    api_key: String,
    base_url: String,
    no_proxy: bool,
}

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

/// Check if a URL is effectively the default OpenAI endpoint.
/// Normalizes trailing slashes for comparison.
pub fn is_default_url(url: &str) -> bool {
    let normalized = url.trim_end_matches('/');
    let default_normalized = DEFAULT_BASE_URL.trim_end_matches('/');
    normalized == default_normalized
}

/// Returns true if the request requires an API key.
/// Custom/proxy URLs (LiteLLM, vLLM, etc.) can work keyless.
pub fn requires_api_key(api_key: &str, base_url: &str) -> bool {
    api_key.is_empty() && is_default_url(base_url)
}
const STORE_FILE: &str = "api-config.json";
const STORE_KEY_API_KEY: &str = "api_key";
const STORE_KEY_BASE_URL: &str = "base_url";
const STORE_KEY_NO_PROXY: &str = "no_proxy";

impl ApiState {
    /// Create from stored config, with environment variable override.
    /// Priority: env > store > default (env wins for dev convenience).
    pub fn load(app: &tauri::AppHandle) -> Self {
        let mut api_key = String::new();
        let mut base_url = DEFAULT_BASE_URL.to_string();
        let mut no_proxy = false;

        // Try loading from persistent store
        if let Ok(store) = app.store(STORE_FILE) {
            if let Some(val) = store.get(STORE_KEY_API_KEY) {
                if let Some(s) = val.as_str() {
                    if !s.is_empty() {
                        api_key = s.to_string();
                    }
                }
            }
            if let Some(val) = store.get(STORE_KEY_BASE_URL) {
                if let Some(s) = val.as_str() {
                    if !s.is_empty() {
                        base_url = s.to_string();
                    }
                }
            }
            if let Some(val) = store.get(STORE_KEY_NO_PROXY) {
                if let Some(b) = val.as_bool() {
                    no_proxy = b;
                }
            }
        }

        // Env vars override store (dev convenience)
        if let Some(k) = read_env_non_empty("OPENAI_API_KEY") {
            api_key = k;
        }
        if let Some(u) = read_env_non_empty("OPENAI_API_URL") {
            base_url = u;
        }

        let client = crate::utils::http::build_http_client(no_proxy);

        Self {
            inner: Mutex::new(ApiConfig { api_key, base_url, no_proxy }),
            client: Mutex::new(client),
        }
    }

    /// Toggle proxy bypass and rebuild the HTTP client.
    pub fn set_no_proxy(&self, enabled: bool, app: &tauri::AppHandle) -> Result<(), AppError> {
        // Persist
        let store = app.store(STORE_FILE).map_err(|e| AppError::Config(e.to_string()))?;
        store.set(STORE_KEY_NO_PROXY, serde_json::json!(enabled));
        store.save().map_err(|e| AppError::Config(e.to_string()))?;

        // Update in-memory
        let mut cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        cfg.no_proxy = enabled;
        drop(cfg);

        // Rebuild client with new proxy setting
        *self.client.lock().map_err(|_| AppError::Lock("API client lock poisoned".into()))? = crate::utils::http::build_http_client(enabled);
        Ok(())
    }

    /// Get current no_proxy setting.
    pub fn get_no_proxy(&self) -> Result<bool, AppError> {
        Ok(self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?.no_proxy)
    }

    /// Returns true if the user has configured API access.
    /// Either an API key is set, or a custom base URL is configured
    /// (for keyless proxies like LiteLLM, vLLM, local servers).
    pub fn has_api_access(&self) -> Result<bool, AppError> {
        let cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        Ok(!cfg.api_key.is_empty() || !is_default_url(&cfg.base_url))
    }

    /// Returns true only if an actual API key string is stored (non-empty).
    /// Use this when the UI needs to distinguish "key exists" from "proxy-only access".
    pub fn has_stored_key(&self) -> Result<bool, AppError> {
        let cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        Ok(!cfg.api_key.is_empty())
    }

    /// Update API configuration and persist to store.
    /// `api_key`: Some("key") sets key, Some("") clears key, None leaves unchanged.
    /// `base_url`: Some("url") sets url, Some("") resets to default, None leaves unchanged.
    pub fn set_config(
        &self,
        key: Option<String>,
        url: Option<String>,
        app: &tauri::AppHandle,
    ) -> Result<(), AppError> {
        let cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        // Compute new values without mutating yet (trim whitespace from key/URL)
        let new_key = key.map(|k| k.trim().to_string()).unwrap_or_else(|| cfg.api_key.clone());
        let new_url = match url {
            Some(u) if u.trim().is_empty() => DEFAULT_BASE_URL.to_string(),
            Some(u) => u.trim().to_string(),
            None => cfg.base_url.clone(),
        };
        drop(cfg); // release lock before I/O

        // Persist FIRST — if this fails, in-memory state stays unchanged
        let store = app
            .store(STORE_FILE)
            .map_err(|e| AppError::Config(format!("Failed to open config store: {e}")))?;
        store.set(STORE_KEY_API_KEY, serde_json::json!(&new_key));
        store.set(STORE_KEY_BASE_URL, serde_json::json!(&new_url));
        store
            .save()
            .map_err(|e| AppError::Config(format!("Failed to persist config: {e}")))?;

        // Persistence succeeded — now update in-memory state
        let mut cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        cfg.api_key = new_key;
        cfg.base_url = new_url;
        Ok(())
    }

    /// Return a clone of the shared reqwest::Client (cheap – internally Arc'd).
    pub fn client(&self) -> Result<reqwest::Client, AppError> {
        Ok(self.client.lock().map_err(|_| AppError::Lock("API client lock poisoned".into()))?.clone())
    }

    /// Get the API key and base URL from backend state only.
    pub fn effective(&self) -> Result<(String, String), AppError> {
        let cfg = self.inner.lock().map_err(|_| AppError::Lock("API config lock poisoned".into()))?;
        Ok((cfg.api_key.clone(), cfg.base_url.clone()))
    }
}

// ── Run Registry for abort support ──

pub struct RunEntry {
    pub abort_handle: tokio::task::AbortHandle,
}

#[derive(Clone)]
pub struct RunRegistry {
    entries: Arc<TokioMutex<HashMap<String, RunEntry>>>,
}

impl RunRegistry {
    pub fn new() -> Self {
        Self {
            entries: Arc::new(TokioMutex::new(HashMap::new())),
        }
    }

    pub async fn register(&self, request_id: String, abort_handle: tokio::task::AbortHandle) {
        let mut entries = self.entries.lock().await;
        entries.insert(request_id, RunEntry { abort_handle });
    }

    pub async fn abort(&self, request_id: &str) -> bool {
        let mut entries = self.entries.lock().await;
        if let Some(entry) = entries.remove(request_id) {
            entry.abort_handle.abort();
            true
        } else {
            false
        }
    }

    pub async fn remove(&self, request_id: &str) {
        let mut entries = self.entries.lock().await;
        entries.remove(request_id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── is_default_url tests ──

    #[test]
    fn is_default_url_exact_match() {
        assert!(is_default_url("https://api.openai.com/v1"));
    }

    #[test]
    fn is_default_url_with_trailing_slash() {
        assert!(is_default_url("https://api.openai.com/v1/"));
    }

    #[test]
    fn is_default_url_custom_url() {
        assert!(!is_default_url("https://my-proxy.example.com/v1"));
    }

    #[test]
    fn is_default_url_empty_string() {
        assert!(!is_default_url(""));
    }

    #[test]
    fn is_default_url_localhost() {
        assert!(!is_default_url("http://localhost:8080/v1"));
    }

    // ── requires_api_key tests ──

    #[test]
    fn requires_key_empty_key_default_url() {
        assert!(requires_api_key("", DEFAULT_BASE_URL));
    }

    #[test]
    fn requires_key_has_key_default_url() {
        assert!(!requires_api_key("sk-test-key", DEFAULT_BASE_URL));
    }

    #[test]
    fn requires_key_empty_key_custom_url() {
        assert!(!requires_api_key("", "http://localhost:8080/v1"));
    }

    #[test]
    fn requires_key_has_key_custom_url() {
        assert!(!requires_api_key("sk-test", "http://localhost:8080/v1"));
    }

    // ── RunRegistry tests ──

    #[tokio::test]
    async fn run_registry_register_and_abort() {
        let registry = RunRegistry::new();
        let handle = tokio::task::spawn(async { 42 }).abort_handle();
        registry.register("req-1".into(), handle).await;
        let aborted = registry.abort("req-1").await;
        assert!(aborted);
    }

    #[tokio::test]
    async fn run_registry_abort_nonexistent() {
        let registry = RunRegistry::new();
        let aborted = registry.abort("does-not-exist").await;
        assert!(!aborted);
    }

    #[tokio::test]
    async fn run_registry_remove_cleans_up() {
        let registry = RunRegistry::new();
        let handle = tokio::task::spawn(async {}).abort_handle();
        registry.register("req-2".into(), handle).await;
        registry.remove("req-2").await;
        // After remove, abort should return false
        let aborted = registry.abort("req-2").await;
        assert!(!aborted);
    }

    #[tokio::test]
    async fn run_registry_multiple_entries() {
        let registry = RunRegistry::new();
        let h1 = tokio::task::spawn(async {}).abort_handle();
        let h2 = tokio::task::spawn(async {}).abort_handle();
        registry.register("a".into(), h1).await;
        registry.register("b".into(), h2).await;
        assert!(registry.abort("a").await);
        assert!(registry.abort("b").await);
        // Both removed after abort
        assert!(!registry.abort("a").await);
        assert!(!registry.abort("b").await);
    }
}
