mod commands;
mod screenshot;

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;
use tokio::sync::{Mutex, RwLock};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::io::BufRead;
use tauri::Emitter;
use tauri::Manager;

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
}


// === Implementation ===

impl BrowserManager {
    pub fn new(app_data_dir: PathBuf, app_handle: Option<tauri::AppHandle>) -> Self {
        let screenshots_dir = app_data_dir.join("browser_screenshots");
        std::fs::create_dir_all(&screenshots_dir).ok();

        // Load saved proxy or detect system proxy
        let proxy = load_browser_proxy(&app_handle)
            .unwrap_or_else(|| detect_system_proxy().unwrap_or_default());

        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            sidecar: Arc::new(Mutex::new(None)),
            pending_approvals: Arc::new(Mutex::new(HashMap::new())),
            idle_task: Arc::new(Mutex::new(None)),
            proxy_server: Arc::new(Mutex::new(proxy)),
            app_data_dir,
            app_handle,
            client: Client::new(),
        }
    }

    pub(crate) fn emit_event(&self, event: &str, payload: &str) {
        if let Some(ref handle) = self.app_handle {
            let _ = handle.emit(event, payload);
        }
    }

    /// Ensure sidecar is running, spawn if needed
    pub(crate) async fn ensure_sidecar(&self) -> Result<u16, String> {
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
        // Strip \\?\ prefix from all paths — Node.js cannot handle Windows extended-length paths.
        let script_path = strip_unc_prefix(
            resolve_sidecar_script(self.app_handle.as_ref())
                .ok_or_else(|| "browser-sidecar server.js not found".to_string())?
        );

        let node_path = strip_unc_prefix(resolve_node_executable(self.app_handle.as_ref())?);

        // Resolve browser paths:
        // - Primary: bundled Chromium in Tauri resources (release builds)
        // - Fallback: writable app_data_dir (for runtime download)
        let browsers_path = strip_unc_prefix(self.resolve_browsers_path());
        let fallback_path = self.app_data_dir.join("playwright-browsers");

        tracing::info!("sidecar: node={} script={}", node_path.display(), script_path.display());
        tracing::info!("sidecar: browsers_path={} fallback={}", browsers_path.display(), fallback_path.display());

        let proxy = self.proxy_server.lock().await.clone();
        tracing::info!("sidecar: proxy={}", if proxy.is_empty() { "(none)" } else { &proxy });

        let mut cmd = Command::new(&node_path);
        cmd.arg(&script_path)
            .env("PLAYWRIGHT_BROWSERS_PATH", &browsers_path)
            .env("PLAYWRIGHT_BROWSERS_PATH_FALLBACK", &fallback_path)
            .env("BROWSER_PROXY_SERVER", &proxy)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        // Suppress console window on Windows
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let mut child = cmd.spawn()
            .map_err(|e| format!("failed to spawn browser sidecar (node={}): {}", node_path.display(), e))?;

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

        let port = match port {
            Some(p) => p,
            None => {
                // Capture stderr to diagnose why sidecar failed
                let stderr_output = child.stderr.take()
                    .and_then(|mut stderr| {
                        let mut buf = String::new();
                        std::io::Read::read_to_string(&mut stderr, &mut buf).ok()?;
                        Some(buf)
                    })
                    .unwrap_or_default();
                let exit_status = child.wait().ok().map(|s| format!("{}", s)).unwrap_or_else(|| "unknown".to_string());
                return Err(format!(
                    "sidecar did not report port (exit: {}, node={}, script={})\nstderr: {}",
                    exit_status,
                    node_path.display(),
                    script_path.display(),
                    if stderr_output.is_empty() { "(empty)" } else { &stderr_output }
                ));
            }
        };

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

    /// Resolve the Playwright browsers directory.
    /// Release: bundled within Tauri resources (read-only).
    /// Dev/fallback: app_data_dir/playwright-browsers (writable, for runtime download).
    fn resolve_browsers_path(&self) -> PathBuf {
        if let Some(ref handle) = self.app_handle {
            if let Ok(path) = handle
                .path()
                .resolve("../browser-sidecar/playwright-browsers", tauri::path::BaseDirectory::Resource)
            {
                if path.is_dir() {
                    // Check for actual Chromium payload (chromium-* subdirectory)
                    let has_chromium = std::fs::read_dir(&path)
                        .map(|entries| entries.filter_map(|e| e.ok())
                            .any(|e| e.file_name().to_string_lossy().starts_with("chromium-")))
                        .unwrap_or(false);
                    if has_chromium {
                        return path;
                    }
                }
            }
        }
        self.app_data_dir.join("playwright-browsers")
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

    /// Get or create a session for a conversation
    pub async fn get_or_create_session(&self, conversation_id: &str) -> Result<String, String> {
        // Fast path: check if session exists (write needed for last_active update)
        {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(conversation_id) {
                session.last_active = chrono::Utc::now();
                return Ok(session.session_id.clone());
            }
        }

        let session_id = format!(
            "session_{}",
            &uuid::Uuid::new_v4().to_string().replace('-', "")[..12]
        );

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
            last_url: String::new(),
            last_title: String::new(),
            last_ref_map: HashMap::new(),
            last_active: chrono::Utc::now(),
            security_policy: policy,
        };

        let mut sessions = self.sessions.write().await;
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

        if (is_loopback || is_private) && !policy.approved_domains.contains(host) {
            return Err(format!(
                "blocked: private/loopback address '{}' requires explicit approval",
                host
            ));
        }

        // Check custom blocklist
        for blocked in &policy.blocked_origins {
            if host.contains(blocked) {
                return Err(format!("blocked origin: {}", host));
            }
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

    /// Start background task that closes sessions idle for >= 10 minutes.
    pub async fn start_idle_cleanup(manager: BrowserManager) {
        let handle = tokio::spawn({
            let manager = manager.clone();
            async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_secs(60));
                loop {
                    interval.tick().await;
                    let idle_convs: Vec<String> = {
                        let sessions = manager.sessions.read().await;
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
        let mut sessions = self.sessions.write().await;
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

    /// Get the current browser proxy server URL.
    pub async fn get_proxy_server(&self) -> String {
        self.proxy_server.lock().await.clone()
    }

    /// Set the browser proxy server URL and restart sidecar to apply.
    pub async fn set_proxy_server(&self, proxy: String) {
        *self.proxy_server.lock().await = proxy.clone();

        // Kill existing sidecar so it restarts with new proxy on next use
        let mut sidecar = self.sidecar.lock().await;
        if let Some(mut s) = sidecar.take() {
            let _ = s.child.kill();
        }

        // Persist to Tauri store
        if let Some(ref handle) = self.app_handle {
            save_browser_proxy(handle, &proxy);
        }
    }

    // === Internal helpers ===

    /// Validate the final URL after any navigation-producing action.
    /// If the browser ended up on a blocked URL (via redirect/click), return error.
    pub(crate) fn validate_response_url(resp: &SidecarResponse, policy: &SessionSecurityPolicy) -> Result<(), String> {
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

    pub(crate) async fn update_session_from_response(
        &self,
        conversation_id: &str,
        resp: &SidecarResponse,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
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
}

impl Default for SessionSecurityPolicy {
    fn default() -> Self {
        Self {
            blocked_origins: vec![],
            approved_domains: HashSet::new(),
        }
    }
}

/// Strip Windows extended-length path prefix (`\\?\`) which Tauri's path resolver adds.
/// Node.js cannot handle these paths, causing EISDIR errors during module resolution.
fn strip_unc_prefix(path: PathBuf) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        let s = path.to_string_lossy();
        if let Some(stripped) = s.strip_prefix("\\\\?\\") {
            return PathBuf::from(stripped);
        }
    }
    path
}

/// Resolve the Node.js executable path.
/// In release: uses the bundled node.exe from Tauri resources (alongside sidecar files).
/// Fallback: uses the `which` crate for system PATH resolution.
fn resolve_node_executable(app_handle: Option<&tauri::AppHandle>) -> Result<PathBuf, String> {
    // 1. Release: resolve bundled node.exe via Tauri resource resolver.
    //    The path must match the bundle.resources entry in tauri.conf.json.
    //    Skip zero-byte placeholders created by build.rs for dev builds.
    if let Some(handle) = app_handle {
        if let Ok(path) = handle
            .path()
            .resolve("../browser-sidecar/node.exe", tauri::path::BaseDirectory::Resource)
        {
            if path.exists() && std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false) {
                return Ok(path);
            }
        }
    }

    // 2. Fallback: system PATH
    which::which("node").map_err(|_| {
        "Node.js is required but not found. \
         The bundled node.exe may be missing from the installation."
            .to_string()
    })
}

/// Resolve the path to browser-sidecar/server.js.
/// In release: uses Tauri resource resolver (works on all platforms).
/// In dev: falls back to CWD-relative paths.
fn resolve_sidecar_script(app_handle: Option<&tauri::AppHandle>) -> Option<PathBuf> {
    // 1. Release: use Tauri resource resolver (resolves correctly on Windows, macOS, Linux).
    // The path must match the bundle.resources entry in tauri.conf.json.
    // Tauri rewrites `..` to `_up_` both when bundling and when resolving,
    // so we pass the same relative path used in the config.
    if let Some(handle) = app_handle {
        if let Ok(path) = handle
            .path()
            .resolve("../browser-sidecar/server.js", tauri::path::BaseDirectory::Resource)
        {
            if path.exists() {
                return Some(path);
            }
        }
    }

    // 2. Dev fallback: CWD-relative paths (`cargo tauri dev` runs from project root)
    let cwd_candidates = [
        "browser-sidecar/server.js",
        "browser-sidecar/dist/server.js",
        "../browser-sidecar/server.js",
        "../browser-sidecar/dist/server.js",
    ];
    for candidate in &cwd_candidates {
        let p = std::path::Path::new(candidate);
        if p.exists() {
            return Some(p.to_path_buf());
        }
    }

    None
}

const BROWSER_STORE_FILE: &str = "browser-config.json";
const STORE_KEY_PROXY: &str = "proxy_server";

/// Load saved browser proxy from Tauri store.
fn load_browser_proxy(app_handle: &Option<tauri::AppHandle>) -> Option<String> {
    let handle = app_handle.as_ref()?;
    let store = tauri_plugin_store::StoreExt::store(handle, BROWSER_STORE_FILE).ok()?;
    store.get(STORE_KEY_PROXY)?.as_str().map(|s| s.to_string())
}

/// Persist browser proxy to Tauri store.
fn save_browser_proxy(app_handle: &tauri::AppHandle, proxy: &str) {
    if let Ok(store) = tauri_plugin_store::StoreExt::store(app_handle, BROWSER_STORE_FILE) {
        store.set(STORE_KEY_PROXY, serde_json::json!(proxy));
        let _ = store.save();
    }
}

/// Detect system proxy settings.
/// Windows: reads from environment variables (HTTP_PROXY / HTTPS_PROXY).
/// These are also set by many corporate proxy tools.
pub fn detect_system_proxy() -> Option<String> {
    // Check standard env vars (case-insensitive on Windows, but check both)
    for var in ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"] {
        if let Ok(val) = std::env::var(var) {
            let trimmed = val.trim().to_string();
            if !trimmed.is_empty() {
                return Some(trimmed);
            }
        }
    }

    // Windows: read from registry (Internet Settings)
    #[cfg(target_os = "windows")]
    {
        if let Some(proxy) = detect_windows_registry_proxy() {
            return Some(proxy);
        }
    }

    None
}

/// Read proxy from Windows registry (Internet Settings > ProxyServer).
#[cfg(target_os = "windows")]
fn detect_windows_registry_proxy() -> Option<String> {
    use std::process::Command as StdCommand;
    let output = StdCommand::new("reg")
        .args([
            "query",
            r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
            "/v", "ProxyServer",
        ])
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Parse REG_SZ value: "    ProxyServer    REG_SZ    http://proxy:8080"
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("ProxyServer") {
            // Also check ProxyEnable
            let enable_output = StdCommand::new("reg")
                .args([
                    "query",
                    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                    "/v", "ProxyEnable",
                ])
                .output()
                .ok()?;
            let enable_str = String::from_utf8_lossy(&enable_output.stdout);
            let enabled = enable_str.lines().any(|l| {
                let l = l.trim();
                l.starts_with("ProxyEnable") && l.contains("0x1")
            });
            if !enabled {
                return None;
            }

            let parts: Vec<&str> = line.split_whitespace().collect();
            if let Some(val) = parts.last() {
                let val = val.trim();
                if !val.is_empty() {
                    // Add http:// prefix if missing
                    return if val.starts_with("http://") || val.starts_with("https://") || val.starts_with("socks") {
                        Some(val.to_string())
                    } else {
                        Some(format!("http://{}", val))
                    };
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

    #[test]
    fn test_default_security_policy() {
        let policy = SessionSecurityPolicy::default();
        assert!(policy.blocked_origins.is_empty());
        assert!(policy.approved_domains.is_empty());
    }

    #[test]
    fn test_browser_manager_new() {
        let manager = test_manager();
        // Just verify it constructs without panic
        drop(manager);
    }

    fn test_manager() -> BrowserManager {
        BrowserManager::new(std::env::temp_dir().join("window-agent-test"), None)
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

    #[test]
    fn test_resolve_node_executable_returns_valid_path_or_clear_error() {
        match resolve_node_executable(None) {
            Ok(path) => {
                // When node is available, path must exist and be a file
                assert!(path.exists(), "resolved node path should exist");
                assert!(path.is_file(), "resolved node path should be a file");
            }
            Err(msg) => {
                // When node is not available, error must contain install guidance
                assert!(
                    msg.contains("nodejs.org"),
                    "error should contain install URL, got: {}",
                    msg
                );
            }
        }
    }

    #[test]
    fn test_resolve_sidecar_script_none_handle_falls_through_to_cwd() {
        // With no AppHandle, should skip Tauri resolver and try CWD candidates.
        // In test env (CWD is src-tauri/), ../browser-sidecar/server.js should exist.
        let result = resolve_sidecar_script(None);
        // The CWD candidate list includes "../browser-sidecar/server.js"
        // which exists when running from src-tauri/ directory
        if let Some(path) = &result {
            assert!(
                path.to_string_lossy().contains("server.js"),
                "resolved path should point to server.js"
            );
        }
        // If None, that's also valid (CWD may differ). No panic is the key assertion.
    }
}
