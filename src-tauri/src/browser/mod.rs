mod commands;
mod screenshot;
pub(crate) mod security;
mod session;
pub(crate) mod sidecar;

pub use sidecar::{detect_system_proxy, detect_system_no_proxy};

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::Emitter;

// === Types ===

#[derive(Clone)]
pub struct BrowserManager {
    pub(crate) sessions: Arc<RwLock<HashMap<String, BrowserSession>>>,
    sidecar: Arc<Mutex<Option<SidecarProcess>>>,
    /// Pending domain approvals for conversations that don't have a session yet.
    /// Applied when the session is created.
    pending_approvals: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    idle_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    /// Proxy server URL for browser (e.g. "http://proxy:8080"). Empty = system default.
    proxy_server: Arc<Mutex<String>>,
    /// Comma-separated list of hosts to bypass proxy (NO_PROXY). Empty = none.
    no_proxy: Arc<Mutex<String>>,
    /// Whether to run the browser in headless mode (no visible window).
    headless: Arc<Mutex<bool>>,
    pub(crate) app_data_dir: PathBuf,
    pub(crate) app_handle: Option<tauri::AppHandle>,
    pub(crate) client: Client,
}

struct SidecarProcess {
    #[allow(dead_code)] // Kept alive to maintain process lifetime
    child: Child,
    port: u16,
}

pub struct BrowserSession {
    pub session_id: String,
    pub last_url: String,
    pub last_title: String,
    pub last_ref_map: HashMap<u32, ElementRef>,
    pub last_active: chrono::DateTime<chrono::Utc>,
    pub security_policy: SessionSecurityPolicy,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ElementRef {
    pub selector: String,
    pub role: String,
    pub name: String,
    pub tag: String,
    #[serde(default, alias = "isPassword")]
    pub is_password: bool,
}

pub struct SessionSecurityPolicy {
    pub blocked_origins: Vec<String>,
    pub approved_domains: HashSet<String>,
}

#[derive(Deserialize)]
pub(crate) struct SidecarResponse {
    pub(crate) success: bool,
    pub(crate) url: Option<String>,
    pub(crate) title: Option<String>,
    pub(crate) snapshot: Option<String>,
    pub(crate) ref_map: Option<HashMap<String, ElementRef>>,
    pub(crate) element_count: Option<usize>,
    pub(crate) error: Option<String>,
    pub(crate) screenshot: Option<String>, // base64 PNG
    /// Extra data from browser_tabs list action
    #[serde(default)]
    pub(crate) tabs: Option<serde_json::Value>,
    /// Extra data from browser_evaluate action
    #[serde(default)]
    pub(crate) eval_result: Option<serde_json::Value>,
    /// Extra data from browser_handle_dialog action
    #[serde(default)]
    pub(crate) dialog: Option<serde_json::Value>,
}


// === Implementation: coordinator and core ===

impl BrowserManager {
    pub fn new(app_data_dir: PathBuf, app_handle: Option<tauri::AppHandle>) -> Self {
        let screenshots_dir = app_data_dir.join("browser_screenshots");
        std::fs::create_dir_all(&screenshots_dir).ok();

        // Load saved settings from AppSettings (unified) or detect system defaults
        let (proxy, no_proxy, headless) = if let Some(ref handle) = app_handle {
            use tauri::Manager;
            let s = handle.state::<crate::settings::AppSettings>().get();
            let p = if s.browser_proxy.is_empty() {
                sidecar::detect_system_proxy().unwrap_or_default()
            } else {
                s.browser_proxy
            };
            let np = if s.browser_no_proxy.is_empty() {
                sidecar::detect_system_no_proxy().unwrap_or_default()
            } else {
                s.browser_no_proxy
            };
            (p, np, s.browser_headless)
        } else {
            (
                sidecar::detect_system_proxy().unwrap_or_default(),
                sidecar::detect_system_no_proxy().unwrap_or_default(),
                false,
            )
        };

        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            sidecar: Arc::new(Mutex::new(None)),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            idle_task: Arc::new(Mutex::new(None)),
            proxy_server: Arc::new(Mutex::new(proxy)),
            no_proxy: Arc::new(Mutex::new(no_proxy)),
            headless: Arc::new(Mutex::new(headless)),
            app_data_dir,
            app_handle,
            client: Client::builder()
                .no_proxy()
                .build()
                .expect("failed to build reqwest client"),
        }
    }

    pub(crate) fn emit_event(&self, event: &str, payload: &str) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit(event, payload);
        }
    }

    /// Send command to sidecar
    pub(crate) async fn send_command(
        &self,
        method: &str,
        session_id: &str,
        params: serde_json::Value,
    ) -> Result<SidecarResponse, String> {
        let port = self.ensure_sidecar().await?;
        let url = format!("http://127.0.0.1:{}/execute", port);

        let body = serde_json::json!({
            "method": method,
            "session_id": session_id,
            "params": params,
        });

        let resp = self
            .client
            .post(&url)
            .json(&body)
            .timeout(std::time::Duration::from_secs(360)) // Allow time for first-run Chromium download
            .send()
            .await
            .map_err(|e| format!("sidecar request failed: {}", e))?;

        let resp_text = resp
            .text()
            .await
            .map_err(|e| format!("failed to read sidecar response: {}", e))?;

        let sidecar_resp: SidecarResponse = serde_json::from_str(&resp_text)
            .map_err(|e| {
                let preview: String = resp_text.chars().take(500).collect();
                format!("invalid sidecar response: {} — preview: {}", e, preview)
            })?;

        if !sidecar_resp.success {
            return Err(sidecar_resp
                .error
                .unwrap_or_else(|| "unknown sidecar error".to_string()));
        }

        Ok(sidecar_resp)
    }

    /// Shutdown everything
    pub async fn shutdown(&self) {
        // Abort idle cleanup task
        let mut idle = self.idle_task.lock().await;
        if let Some(handle) = idle.take() {
            handle.abort();
        }
        drop(idle);

        // Close all sessions
        let conversation_ids: Vec<String> = {
            let sessions = self.sessions.read().await;
            sessions.keys().cloned().collect()
        };
        for conv_id in conversation_ids {
            let _ = self.close_session(&conv_id).await;
        }

        // Gracefully close sidecar, then force kill as safety net
        let mut sidecar = self.sidecar.lock().await;
        if let Some(mut s) = sidecar.take() {
            // Ask sidecar to close all browser contexts gracefully
            let url = format!("http://127.0.0.1:{}/execute", s.port);
            let _ = self
                .client
                .post(&url)
                .json(&serde_json::json!({"method": "close", "session_id": "", "params": {}}))
                .timeout(std::time::Duration::from_secs(5))
                .send()
                .await;
            let _ = s.child.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_manager() -> BrowserManager {
        BrowserManager::new(std::env::temp_dir().join("window-agent-test"), None)
    }

    #[test]
    fn test_browser_manager_new() {
        let manager = test_manager();
        // Just verify it constructs without panic
        drop(manager);
    }

    #[test]
    fn test_sidecar_response_accepts_camel_case_is_password() {
        let json = serde_json::json!({
            "success": true,
            "url": "https://example.com",
            "title": "Example",
            "snapshot": "[1] textbox \"Search\"",
            "ref_map": {
                "1": {
                    "selector": "role=textbox[name=\"Search\"]",
                    "role": "textbox",
                    "name": "Search",
                    "tag": "input",
                    "isPassword": true
                }
            },
            "element_count": 1
        });

        let resp: SidecarResponse = serde_json::from_value(json).unwrap();
        let ref_map = resp.ref_map.unwrap();
        assert!(ref_map.get("1").unwrap().is_password);
    }

    #[test]
    fn test_sidecar_response_defaults_missing_is_password_to_false() {
        let json = serde_json::json!({
            "success": true,
            "url": "https://example.com",
            "title": "Example",
            "snapshot": "[1] link \"Home\"",
            "ref_map": {
                "1": {
                    "selector": "role=link[name=\"Home\"]",
                    "role": "link",
                    "name": "Home",
                    "tag": "a"
                }
            },
            "element_count": 1
        });

        let resp: SidecarResponse = serde_json::from_value(json).unwrap();
        let ref_map = resp.ref_map.unwrap();
        assert!(!ref_map.get("1").unwrap().is_password);
    }
}
