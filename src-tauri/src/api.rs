use serde::{Deserialize, Serialize};
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
    /// Shared HTTP client – reqwest::Client is already Arc-wrapped and Clone,
    /// so it lives outside the Mutex for lock-free reuse.
    client: reqwest::Client,
}

#[derive(Clone)]
struct ApiConfig {
    api_key: String,
    base_url: String,
}

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
const STORE_FILE: &str = "api-config.json";
const STORE_KEY_API_KEY: &str = "api_key";
const STORE_KEY_BASE_URL: &str = "base_url";

impl ApiState {
    /// Create from stored config, with environment variable override.
    /// Priority: env > store > default (env wins for dev convenience).
    pub fn load(app: &tauri::AppHandle) -> Self {
        let mut api_key = String::new();
        let mut base_url = DEFAULT_BASE_URL.to_string();

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
        }

        // Env vars override store (dev convenience)
        if let Ok(k) = std::env::var("OPENAI_API_KEY") {
            if !k.is_empty() {
                api_key = k;
            }
        }
        if let Ok(u) = std::env::var("OPENAI_API_URL") {
            if !u.is_empty() {
                base_url = u;
            }
        }

        Self {
            inner: Mutex::new(ApiConfig { api_key, base_url }),
            client: reqwest::Client::new(),
        }
    }

    pub fn has_api_key(&self) -> bool {
        let cfg = self.inner.lock().unwrap();
        !cfg.api_key.is_empty()
    }

    /// Update API configuration and persist to store.
    /// `api_key`: Some("key") sets key, Some("") clears key, None leaves unchanged.
    /// `base_url`: Some("url") sets url, Some("") resets to default, None leaves unchanged.
    pub fn set_config(
        &self,
        key: Option<String>,
        url: Option<String>,
        app: &tauri::AppHandle,
    ) -> Result<(), String> {
        let cfg = self.inner.lock().unwrap();
        // Compute new values without mutating yet
        let new_key = key.unwrap_or_else(|| cfg.api_key.clone());
        let new_url = match url {
            Some(u) if u.is_empty() => DEFAULT_BASE_URL.to_string(),
            Some(u) => u,
            None => cfg.base_url.clone(),
        };
        drop(cfg); // release lock before I/O

        // Persist FIRST — if this fails, in-memory state stays unchanged
        let store = app.store(STORE_FILE)
            .map_err(|e| format!("Failed to open config store: {e}"))?;
        store.set(STORE_KEY_API_KEY, serde_json::json!(&new_key));
        store.set(STORE_KEY_BASE_URL, serde_json::json!(&new_url));
        store.save()
            .map_err(|e| format!("Failed to persist config: {e}"))?;

        // Persistence succeeded — now update in-memory state
        let mut cfg = self.inner.lock().unwrap();
        cfg.api_key = new_key;
        cfg.base_url = new_url;
        Ok(())
    }

    /// Return a clone of the shared reqwest::Client (cheap – internally Arc'd).
    pub fn client(&self) -> reqwest::Client {
        self.client.clone()
    }

    /// Get the API key and base URL from backend state only.
    pub fn effective(&self) -> (String, String) {
        let cfg = self.inner.lock().unwrap();
        (cfg.api_key.clone(), cfg.base_url.clone())
    }
}

// ── Run Registry for abort support ──

pub struct RunEntry {
    pub abort_handle: tokio::task::AbortHandle,
    pub started_at: chrono::DateTime<chrono::Utc>,
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
        entries.insert(
            request_id,
            RunEntry {
                abort_handle,
                started_at: chrono::Utc::now(),
            },
        );
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

// ── Request/Response types for Tauri commands ──

#[derive(Deserialize)]
#[allow(dead_code)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ChatCompletionRequest {
    pub messages: Vec<serde_json::Value>,
    pub system_prompt: String,
    pub model: String,
    pub temperature: Option<f64>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<u32>,
    pub tools: Option<Vec<serde_json::Value>>,
}

#[derive(Serialize)]
pub struct ChatCompletionResponse {
    pub content: String,
    pub reasoning_content: Option<String>,
}

#[derive(Deserialize)]
pub struct SetApiConfigRequest {
    pub api_key: Option<String>,
    pub base_url: Option<String>,
}

#[derive(Deserialize)]
pub struct BootstrapCompletionRequest {
    pub messages: Vec<serde_json::Value>,
    pub model: String,
    pub tools: Vec<serde_json::Value>,
}

#[derive(Serialize)]
pub struct BootstrapCompletionResponse {
    pub message: serde_json::Value,
}

// ── Tool calling types ──

#[derive(Serialize, Clone, Debug)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub r#type: String,
    pub function: ToolCallFunction,
}

#[derive(Serialize, Clone, Debug)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCallDelta {
    pub index: usize,
    pub id: Option<String>,
    pub function: Option<ToolCallFunctionDelta>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ToolCallFunctionDelta {
    pub name: Option<String>,
    pub arguments: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct StreamChunkPayload {
    pub request_id: String,
    pub delta: String,
    pub reasoning_delta: Option<String>,
    pub tool_calls_delta: Option<Vec<ToolCallDelta>>,
}

#[derive(Serialize, Clone)]
pub struct StreamDonePayload {
    pub request_id: String,
    pub full_content: String,
    pub reasoning_content: Option<String>,
    pub tool_calls: Option<Vec<ToolCall>>,
    pub error: Option<String>,
}
