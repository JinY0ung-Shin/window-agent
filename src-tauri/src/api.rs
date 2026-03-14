use serde::{Deserialize, Serialize};
use std::sync::Mutex;

/// App-level API configuration state managed in memory only.
/// The API key never leaves the backend process.
pub struct ApiState {
    inner: Mutex<ApiConfig>,
}

#[derive(Clone)]
struct ApiConfig {
    api_key: String,
    base_url: String,
}

const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";

impl ApiState {
    /// Create from environment variables (called once at startup).
    pub fn from_env() -> Self {
        let api_key = std::env::var("OPENAI_API_KEY").unwrap_or_default();
        let base_url = std::env::var("OPENAI_API_URL")
            .unwrap_or_else(|_| DEFAULT_BASE_URL.to_string());

        Self {
            inner: Mutex::new(ApiConfig { api_key, base_url }),
        }
    }

    pub fn has_api_key(&self) -> bool {
        let cfg = self.inner.lock().unwrap();
        !cfg.api_key.is_empty()
    }

    /// Update API configuration.
    /// `api_key`: Some("key") sets key, Some("") clears key, None leaves unchanged.
    /// `base_url`: Some("url") sets url, Some("") resets to default, None leaves unchanged.
    pub fn set_config(&self, key: Option<String>, url: Option<String>) {
        let mut cfg = self.inner.lock().unwrap();
        if let Some(k) = key {
            cfg.api_key = k; // empty string = intentional clear
        }
        if let Some(u) = url {
            cfg.base_url = if u.is_empty() { DEFAULT_BASE_URL.to_string() } else { u };
        }
    }

    /// Get the API key and base URL from backend state only.
    /// The renderer never controls the target URL — this prevents
    /// key exfiltration via attacker-controlled endpoints.
    pub fn effective(&self) -> (String, String) {
        let cfg = self.inner.lock().unwrap();
        (cfg.api_key.clone(), cfg.base_url.clone())
    }
}

// ── Request/Response types for Tauri commands ──

#[derive(Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

#[derive(Deserialize)]
pub struct ChatCompletionRequest {
    pub messages: Vec<ChatMessage>,
    pub system_prompt: String,
    pub model: String,
    pub temperature: Option<f64>,
    pub thinking_enabled: bool,
    pub thinking_budget: Option<u32>,
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
