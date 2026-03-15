use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::Mutex;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use tauri::Emitter;

// === Types ===

#[derive(Clone)]
pub struct BrowserManager {
    pub(crate) sessions: Arc<Mutex<HashMap<String, BrowserSession>>>,
    sidecar: Arc<Mutex<Option<SidecarProcess>>>,
    /// Pending domain approvals for conversations that don't have a session yet.
    /// Applied when the session is created.
    pending_approvals: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    idle_task: Arc<Mutex<Option<tokio::task::JoinHandle<()>>>>,
    app_data_dir: PathBuf,
    app_handle: Option<tauri::AppHandle>,
    client: Client,
}

struct SidecarProcess {
    #[allow(dead_code)] // Kept alive to maintain process lifetime
    child: Child,
    port: u16,
}

pub struct BrowserSession {
    pub session_id: String,
    #[allow(dead_code)] // Used as HashMap key context; may be needed for logging
    pub conversation_id: String,
    pub last_url: String,
    pub last_title: String,
    pub last_ref_map: HashMap<u32, ElementRef>,
    #[allow(dead_code)] // Retained for future session analytics
    pub created_at: chrono::DateTime<chrono::Utc>,
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
    #[allow(dead_code)] // Reserved for per-session snapshot size control
    pub max_snapshot_size: usize,
}

#[derive(Deserialize)]
struct SidecarResponse {
    success: bool,
    url: Option<String>,
    title: Option<String>,
    snapshot: Option<String>,
    ref_map: Option<HashMap<String, ElementRef>>,
    element_count: Option<usize>,
    error: Option<String>,
    screenshot: Option<String>, // base64 PNG
}

// === Implementation ===

impl BrowserManager {
    pub fn new(app_data_dir: PathBuf, app_handle: Option<tauri::AppHandle>) -> Self {
        let screenshots_dir = app_data_dir.join("browser_screenshots");
        std::fs::create_dir_all(&screenshots_dir).ok();

        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            sidecar: Arc::new(Mutex::new(None)),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            idle_task: Arc::new(Mutex::new(None)),
            app_data_dir,
            app_handle,
            client: Client::new(),
        }
    }

    fn emit_event(&self, event: &str, payload: &str) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit(event, payload);
        }
    }

    /// Ensure sidecar is running, spawn if needed
    async fn ensure_sidecar(&self) -> Result<u16, String> {
        let mut sidecar = self.sidecar.lock().await;
        if let Some(ref s) = *sidecar {
            // Health check
            let url = format!("http://127.0.0.1:{}/health", s.port);
            if self.client.get(&url).send().await.is_ok() {
                return Ok(s.port);
            }
            // Sidecar died, clear it
            *sidecar = None;
        }

        // Resolve sidecar script path.
        // Try several locations relative to the current executable or CWD.
        let script_path = resolve_sidecar_script()
            .ok_or_else(|| "browser-sidecar server.js not found".to_string())?;

        let mut child = Command::new("node")
            .arg(&script_path)
            .env("PLAYWRIGHT_BROWSERS_PATH", self.app_data_dir.join("playwright-browsers"))
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|e| format!("failed to spawn browser sidecar: {}", e))?;

        // Read port from stdout
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to capture sidecar stdout".to_string())?;
        let reader = std::io::BufReader::new(stdout);

        let mut port: Option<u16> = None;
        for line in reader.lines() {
            let line = line.map_err(|e| format!("failed to read sidecar output: {}", e))?;
            if line.starts_with("CHROMIUM_INSTALL_START") {
                self.emit_event("browser:chromium-installing", "");
                continue;
            }
            if line.starts_with("CHROMIUM_INSTALL_DONE") {
                self.emit_event("browser:chromium-installed", "");
                continue;
            }
            if let Some(reason) = line.strip_prefix("CHROMIUM_INSTALL_FAILED=") {
                self.emit_event("browser:chromium-install-failed", reason);
                return Err(format!("Chromium installation failed: {}", reason));
            }
            if let Some(p) = line.strip_prefix("SIDECAR_PORT=") {
                port = Some(
                    p.parse::<u16>()
                        .map_err(|e| format!("invalid port: {}", e))?,
                );
                break;
            }
        }

        let port = port.ok_or_else(|| "sidecar did not report port".to_string())?;

        // Health check with retries
        let url = format!("http://127.0.0.1:{}/health", port);
        for _ in 0..10 {
            if self.client.get(&url).send().await.is_ok() {
                *sidecar = Some(SidecarProcess { child, port });
                return Ok(port);
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        Err("sidecar health check failed after startup".to_string())
    }

    /// Send command to sidecar
    async fn send_command(
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
            .timeout(std::time::Duration::from_secs(60))
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

    /// Get or create a session for a conversation
    pub async fn get_or_create_session(&self, conversation_id: &str) -> Result<String, String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(conversation_id) {
            session.last_active = chrono::Utc::now();
            return Ok(session.session_id.clone());
        }

        let session_id = format!(
            "session_{}",
            &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]
        );

        // Release lock before async call
        drop(sessions);

        // Create session in sidecar
        self.send_command("create_session", &session_id, serde_json::json!({}))
            .await?;

        let mut policy = SessionSecurityPolicy::default();

        // Apply any pending domain approvals that arrived before the session existed
        {
            let mut pending = self.pending_approvals.lock().await;
            if let Some(domains) = pending.remove(conversation_id) {
                policy.approved_domains = domains;
            }
        }

        let session = BrowserSession {
            session_id: session_id.clone(),
            conversation_id: conversation_id.to_string(),
            last_url: String::new(),
            last_title: String::new(),
            last_ref_map: HashMap::new(),
            created_at: chrono::Utc::now(),
            last_active: chrono::Utc::now(),
            security_policy: policy,
        };

        let mut sessions = self.sessions.lock().await;
        sessions.insert(conversation_id.to_string(), session);
        Ok(session_id)
    }

    /// Validate URL against security policy
    pub fn validate_url(url: &str, policy: &SessionSecurityPolicy) -> Result<(), String> {
        let parsed = url::Url::parse(url).map_err(|e| format!("invalid URL: {}", e))?;

        let scheme = parsed.scheme();
        let host = parsed.host_str().unwrap_or("");

        // Block dangerous schemes
        let blocked_schemes = [
            "file",
            "chrome",
            "about",
            "chrome-extension",
            "devtools",
            "javascript",
            "data",
        ];
        if blocked_schemes.contains(&scheme) {
            return Err(format!("blocked scheme: {}", scheme));
        }

        // Block loopback and private networks
        let is_loopback =
            host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0";
        let is_private = host.starts_with("10.")
            || host.starts_with("192.168.")
            || (host.starts_with("172.") && {
                if let Some(second) = host.split('.').nth(1) {
                    second
                        .parse::<u8>()
                        .map(|n| (16..=31).contains(&n))
                        .unwrap_or(false)
                } else {
                    false
                }
            })
            || host.ends_with(".local")
            || host.ends_with(".internal");

        if is_loopback || is_private {
            if !policy.approved_domains.contains(host) {
                return Err(format!(
                    "blocked: private/loopback address '{}' requires explicit approval",
                    host
                ));
            }
        }

        // Check custom blocklist
        for blocked in &policy.blocked_origins {
            if host.contains(blocked) {
                return Err(format!("blocked origin: {}", host));
            }
        }

        Ok(())
    }

    /// Navigate to URL
    pub async fn navigate(
        &self,
        conversation_id: &str,
        url: &str,
    ) -> Result<BrowserToolResult, String> {
        let session_id = self.get_or_create_session(conversation_id).await?;

        // Validate URL security
        {
            let sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get(conversation_id) {
                Self::validate_url(url, &session.security_policy)?;
            }
        }

        let resp = self
            .send_command("navigate", &session_id, serde_json::json!({ "url": url }))
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Take snapshot of current page
    pub async fn snapshot(
        &self,
        conversation_id: &str,
    ) -> Result<BrowserToolResult, String> {
        let session_id = self.get_or_create_session(conversation_id).await?;
        let resp = self
            .send_command("snapshot", &session_id, serde_json::json!({}))
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Click element by ref number
    pub async fn click(
        &self,
        conversation_id: &str,
        ref_num: u32,
    ) -> Result<BrowserToolResult, String> {
        let session_id = self.get_or_create_session(conversation_id).await?;
        let resp = self
            .send_command("click", &session_id, serde_json::json!({ "ref": ref_num }))
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Type text into element by ref number
    pub async fn type_text(
        &self,
        conversation_id: &str,
        ref_num: u32,
        text: &str,
    ) -> Result<BrowserToolResult, String> {
        // Check if target is password field
        {
            let sessions = self.sessions.lock().await;
            if let Some(session) = sessions.get(conversation_id) {
                if let Some(elem) = session.last_ref_map.get(&ref_num) {
                    if elem.is_password {
                        return Err(
                            "cannot type into password fields for security reasons".to_string()
                        );
                    }
                }
            }
        }

        let session_id = self.get_or_create_session(conversation_id).await?;
        let resp = self
            .send_command(
                "type",
                &session_id,
                serde_json::json!({ "ref": ref_num, "text": text }),
            )
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Wait for specified seconds (clamped to 0.5..10.0)
    pub async fn wait(
        &self,
        conversation_id: &str,
        seconds: f64,
    ) -> Result<BrowserToolResult, String> {
        let seconds = seconds.clamp(0.5, 10.0);
        let session_id = self.get_or_create_session(conversation_id).await?;
        let resp = self
            .send_command(
                "wait",
                &session_id,
                serde_json::json!({ "seconds": seconds }),
            )
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Go back in history
    pub async fn back(
        &self,
        conversation_id: &str,
    ) -> Result<BrowserToolResult, String> {
        let session_id = self.get_or_create_session(conversation_id).await?;
        let resp = self
            .send_command("back", &session_id, serde_json::json!({}))
            .await?;
        self.update_session_from_response(conversation_id, &resp)
            .await?;
        self.build_tool_result(&resp)
    }

    /// Close browser session for a conversation
    pub async fn close_session(&self, conversation_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.remove(conversation_id) {
            let session_id = session.session_id.clone();
            drop(sessions); // release lock before async call
            let _ = self
                .send_command("close_session", &session_id, serde_json::json!({}))
                .await;
        }
        Ok(())
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
            let sessions = self.sessions.lock().await;
            sessions.keys().cloned().collect()
        };
        for conv_id in conversation_ids {
            let _ = self.close_session(&conv_id).await;
        }

        // Kill sidecar
        let mut sidecar = self.sidecar.lock().await;
        if let Some(mut s) = sidecar.take() {
            let _ = s.child.kill();
        }
    }

    /// Start background task that closes sessions idle for >= 10 minutes.
    pub async fn start_idle_cleanup(manager: BrowserManager) {
        let handle = tokio::spawn({
            let manager = manager.clone();
            async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let idle_convs: Vec<String> = {
                        let sessions = manager.sessions.lock().await;
                        sessions
                            .iter()
                            .filter(|(_, s)| {
                                chrono::Utc::now()
                                    .signed_duration_since(s.last_active)
                                    .num_minutes()
                                    >= 10
                            })
                            .map(|(k, _)| k.clone())
                            .collect()
                    };
                    for conv_id in idle_convs {
                        let _ = manager.close_session(&conv_id).await;
                    }
                }
            }
        });
        let mut idle = manager.idle_task.lock().await;
        *idle = Some(handle);
    }

    /// Approve a domain for a conversation's session (called from frontend via Tauri command).
    /// If the session doesn't exist yet, stores as pending and applies when session is created.
    pub async fn approve_domain(&self, conversation_id: &str, domain: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(conversation_id) {
            session.security_policy.approved_domains.insert(domain.to_string());
        } else {
            drop(sessions);
            // Store as pending approval — will be applied when session is created
            let mut pending = self.pending_approvals.lock().await;
            pending
                .entry(conversation_id.to_string())
                .or_insert_with(HashSet::new)
                .insert(domain.to_string());
        }
        Ok(())
    }

    // === Internal helpers ===

    /// Validate the final URL after any navigation-producing action.
    /// If the browser ended up on a blocked URL (via redirect/click), return error.
    fn validate_response_url(resp: &SidecarResponse, policy: &SessionSecurityPolicy) -> Result<(), String> {
        if let Some(url) = &resp.url {
            if url.is_empty() || url == "about:blank" {
                return Ok(()); // Initial blank page is fine
            }
            Self::validate_url(url, policy).map_err(|e| {
                format!("navigation landed on blocked URL: {} ({})", url, e)
            })
        } else {
            Ok(())
        }
    }

    async fn update_session_from_response(
        &self,
        conversation_id: &str,
        resp: &SidecarResponse,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(session) = sessions.get_mut(conversation_id) {
            // Validate final URL against security policy
            Self::validate_response_url(resp, &session.security_policy)?;

            if let Some(url) = &resp.url {
                session.last_url = url.clone();
            }
            if let Some(title) = &resp.title {
                session.last_title = title.clone();
            }
            if let Some(ref_map) = &resp.ref_map {
                session.last_ref_map = ref_map
                    .iter()
                    .filter_map(|(k, v)| k.parse::<u32>().ok().map(|n| (n, v.clone())))
                    .collect();
            }
            session.last_active = chrono::Utc::now();
        }
        Ok(())
    }

    fn build_tool_result(&self, resp: &SidecarResponse) -> Result<BrowserToolResult, String> {
        let snapshot_full = resp.snapshot.clone().unwrap_or_default();
        // Truncate snapshot for model context (4KB max, UTF-8 safe)
        let snapshot = if snapshot_full.len() > 4000 {
            let mut end = 4000;
            while end > 0 && !snapshot_full.is_char_boundary(end) {
                end -= 1;
            }
            format!(
                "{}...\n--- truncated ({} total elements) ---",
                &snapshot_full[..end],
                resp.element_count.unwrap_or(0)
            )
        } else {
            snapshot_full.clone()
        };

        let artifact_id = uuid::Uuid::new_v4().to_string();

        // Save screenshot if present
        let screenshot_path = if let Some(ref b64) = resp.screenshot {
            match self.save_screenshot(&artifact_id, b64) {
                Ok(path) => Some(path),
                Err(_) => None,
            }
        } else {
            None
        };

        Ok(BrowserToolResult {
            success: true,
            url: resp.url.clone().unwrap_or_default(),
            title: resp.title.clone().unwrap_or_default(),
            snapshot,
            snapshot_full,
            element_count: resp.element_count.unwrap_or(0),
            artifact_id,
            screenshot_path,
        })
    }

    /// Decode base64 screenshot and save to disk.
    /// Returns the absolute file path on success.
    pub fn save_screenshot(&self, artifact_id: &str, screenshot_base64: &str) -> Result<String, String> {
        use base64::Engine;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(screenshot_base64)
            .map_err(|e| format!("base64 decode failed: {}", e))?;
        let path = self.app_data_dir
            .join("browser_screenshots")
            .join(format!("{}.png", artifact_id));
        std::fs::write(&path, &bytes)
            .map_err(|e| format!("failed to write screenshot: {}", e))?;
        Ok(path.to_string_lossy().to_string())
    }
}

impl Default for SessionSecurityPolicy {
    fn default() -> Self {
        Self {
            blocked_origins: vec![],
            approved_domains: HashSet::new(),
            max_snapshot_size: 4096,
        }
    }
}

#[derive(Serialize)]
pub struct BrowserToolResult {
    pub success: bool,
    pub url: String,
    pub title: String,
    pub snapshot: String,
    #[serde(skip_serializing)] // Not sent to LLM — only used for artifact storage
    pub snapshot_full: String,
    pub element_count: usize,
    pub artifact_id: String,
    pub screenshot_path: Option<String>,
}

/// Resolve the path to browser-sidecar/server.js.
/// In dev: checks relative to CWD and executable.
/// In release: checks Tauri resource directory and executable sibling.
fn resolve_sidecar_script() -> Option<String> {
    // 1. CWD-relative paths (dev mode: `cargo tauri dev` runs from project root)
    let cwd_candidates = [
        "browser-sidecar/server.js",
        "browser-sidecar/dist/server.js",
        "../browser-sidecar/server.js",
        "../browser-sidecar/dist/server.js",
    ];
    for candidate in &cwd_candidates {
        if std::path::Path::new(candidate).exists() {
            return Some(candidate.to_string());
        }
    }

    // 2. Executable-relative paths (release builds)
    if let Ok(exe) = std::env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            let release_candidates = [
                exe_dir.join("browser-sidecar").join("server.js"),
                exe_dir.join("resources").join("browser-sidecar").join("server.js"),
                // macOS: Contents/Resources/
                exe_dir.join("../Resources/browser-sidecar/server.js"),
            ];
            for candidate in &release_candidates {
                if candidate.exists() {
                    return candidate.to_str().map(|s| s.to_string());
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_allows_https() {
        let policy = SessionSecurityPolicy::default();
        assert!(BrowserManager::validate_url("https://example.com", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_allows_http() {
        let policy = SessionSecurityPolicy::default();
        assert!(BrowserManager::validate_url("http://example.com", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_blocks_file_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("file:///etc/passwd", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked scheme"));
    }

    #[test]
    fn test_validate_url_blocks_javascript_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("javascript:alert(1)", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked scheme"));
    }

    #[test]
    fn test_validate_url_blocks_chrome_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("chrome://settings", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_data_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("data:text/html,<h1>hi</h1>", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_localhost() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://localhost:3000", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("private/loopback"));
    }

    #[test]
    fn test_validate_url_blocks_127() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://127.0.0.1:8080", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_10() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://10.0.0.1/admin", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_192() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://192.168.1.1", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_172() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://172.16.0.1", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_allows_172_outside_range() {
        let policy = SessionSecurityPolicy::default();
        // 172.15.x.x is NOT private range (16-31)
        assert!(BrowserManager::validate_url("http://172.15.0.1", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_blocks_dot_local() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://myhost.local", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_dot_internal() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("http://service.internal", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_approved_domain_bypasses_block() {
        let mut policy = SessionSecurityPolicy::default();
        policy.approved_domains.insert("localhost".to_string());
        assert!(BrowserManager::validate_url("http://localhost:3000", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_custom_blocklist() {
        let mut policy = SessionSecurityPolicy::default();
        policy.blocked_origins.push("evil.com".to_string());
        let result = BrowserManager::validate_url("https://evil.com/phish", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked origin"));
    }

    #[test]
    fn test_validate_url_invalid_url() {
        let policy = SessionSecurityPolicy::default();
        let result = BrowserManager::validate_url("not a url", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid URL"));
    }

    fn test_manager() -> BrowserManager {
        BrowserManager::new(std::env::temp_dir().join("window-agent-test"), None)
    }

    #[test]
    fn test_build_tool_result_truncates_large_snapshot() {
        let manager = test_manager();
        let resp = SidecarResponse {
            success: true,
            url: Some("https://example.com".to_string()),
            title: Some("Example".to_string()),
            snapshot: Some("x".repeat(5000)),
            ref_map: None,
            element_count: Some(100),
            error: None,
            screenshot: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert!(result.snapshot.len() < 5000);
        assert!(result.snapshot.contains("truncated"));
        assert!(result.snapshot.contains("100"));
    }

    #[test]
    fn test_build_tool_result_small_snapshot_not_truncated() {
        let manager = test_manager();
        let resp = SidecarResponse {
            success: true,
            url: Some("https://example.com".to_string()),
            title: Some("Example".to_string()),
            snapshot: Some("small content".to_string()),
            ref_map: None,
            element_count: Some(5),
            error: None,
            screenshot: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert_eq!(result.snapshot, "small content");
        assert!(!result.snapshot.contains("truncated"));
    }

    #[test]
    fn test_build_tool_result_utf8_safe_truncation() {
        let manager = test_manager();
        // Create a string with multi-byte characters that crosses the 4000 byte boundary
        // Korean characters are 3 bytes each in UTF-8
        let korean = "가".repeat(1500); // 4500 bytes
        let resp = SidecarResponse {
            success: true,
            url: Some("https://example.com".to_string()),
            title: Some("Example".to_string()),
            snapshot: Some(korean),
            ref_map: None,
            element_count: Some(50),
            error: None,
            screenshot: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert!(result.snapshot.contains("truncated"));
        // Should not panic and should be valid UTF-8
        assert!(result.snapshot.is_char_boundary(0));
    }

    #[test]
    fn test_default_security_policy() {
        let policy = SessionSecurityPolicy::default();
        assert!(policy.blocked_origins.is_empty());
        assert!(policy.approved_domains.is_empty());
        assert_eq!(policy.max_snapshot_size, 4096);
    }

    #[test]
    fn test_browser_manager_new() {
        let manager = test_manager();
        // Just verify it constructs without panic
        drop(manager);
    }

    #[test]
    fn test_save_screenshot() {
        let tmp = std::env::temp_dir().join("window-agent-test-screenshot");
        let manager = BrowserManager::new(tmp.clone(), None);
        // A minimal valid base64 payload
        let b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, b"fake-png-data");
        let path = manager.save_screenshot("test-artifact-id", &b64).unwrap();
        assert!(std::path::Path::new(&path).exists());
        let content = std::fs::read(&path).unwrap();
        assert_eq!(content, b"fake-png-data");
        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_build_tool_result_includes_artifact_id() {
        let manager = test_manager();
        let resp = SidecarResponse {
            success: true,
            url: Some("https://example.com".to_string()),
            title: Some("Example".to_string()),
            snapshot: Some("content".to_string()),
            ref_map: None,
            element_count: Some(1),
            error: None,
            screenshot: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert!(!result.artifact_id.is_empty());
        assert!(result.screenshot_path.is_none());
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
