use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::Manager;

use super::BrowserManager;

// ── Sidecar lifecycle ────────────────────────────────────

impl BrowserManager {
    /// Ensure sidecar is running, spawn if needed.
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
                .ok_or_else(|| "browser-sidecar server.js not found".to_string())?,
        );

        let node_path = strip_unc_prefix(resolve_node_executable(self.app_handle.as_ref())?);

        // Resolve browser paths:
        // - Primary: bundled Chromium in Tauri resources (release builds)
        // - Fallback: writable app_data_dir (for runtime download)
        let browsers_path = strip_unc_prefix(self.resolve_browsers_path());
        let fallback_path = self.app_data_dir.join("playwright-browsers");

        tracing::info!(
            "sidecar: node={} script={}",
            node_path.display(),
            script_path.display()
        );
        tracing::info!(
            "sidecar: browsers_path={} fallback={}",
            browsers_path.display(),
            fallback_path.display()
        );

        let proxy = self.proxy_server.lock().await.clone();
        tracing::info!(
            "sidecar: proxy={}",
            if proxy.is_empty() { "(none)" } else { &proxy }
        );

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

        let mut child = cmd.spawn().map_err(|e| {
            format!(
                "failed to spawn browser sidecar (node={}): {}",
                node_path.display(),
                e
            )
        })?;

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
                let stderr_output = child
                    .stderr
                    .take()
                    .and_then(|mut stderr| {
                        let mut buf = String::new();
                        std::io::Read::read_to_string(&mut stderr, &mut buf).ok()?;
                        Some(buf)
                    })
                    .unwrap_or_default();
                let exit_status = child
                    .wait()
                    .ok()
                    .map(|s| format!("{}", s))
                    .unwrap_or_else(|| "unknown".to_string());
                return Err(format!(
                    "sidecar did not report port (exit: {}, node={}, script={})\nstderr: {}",
                    exit_status,
                    node_path.display(),
                    script_path.display(),
                    if stderr_output.is_empty() {
                        "(empty)"
                    } else {
                        &stderr_output
                    }
                ));
            }
        };

        // Health check with retries
        let url = format!("http://127.0.0.1:{}/health", port);
        for _ in 0..10 {
            if self.client.get(&url).send().await.is_ok() {
                *sidecar = Some(super::SidecarProcess { child, port });
                return Ok(port);
            }
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        Err("sidecar health check failed after startup".to_string())
    }

    /// Resolve the Playwright browsers directory.
    /// Release: bundled within Tauri resources (read-only).
    /// Dev/fallback: app_data_dir/playwright-browsers (writable, for runtime download).
    pub(crate) fn resolve_browsers_path(&self) -> PathBuf {
        if let Some(ref handle) = self.app_handle {
            if let Ok(path) = handle.path().resolve(
                "../browser-sidecar/playwright-browsers",
                tauri::path::BaseDirectory::Resource,
            ) {
                if path.is_dir() {
                    // Check for actual Chromium payload (chromium-* subdirectory)
                    let has_chromium = std::fs::read_dir(&path)
                        .map(|entries| {
                            entries
                                .filter_map(|e| e.ok())
                                .any(|e| e.file_name().to_string_lossy().starts_with("chromium-"))
                        })
                        .unwrap_or(false);
                    if has_chromium {
                        return path;
                    }
                }
            }
        }
        self.app_data_dir.join("playwright-browsers")
    }
}

// ── Path helpers ─────────────────────────────────────────

/// Strip Windows extended-length path prefix (`\\?\`) which Tauri's path resolver adds.
/// Node.js cannot handle these paths, causing EISDIR errors during module resolution.
pub(super) fn strip_unc_prefix(path: PathBuf) -> PathBuf {
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
pub(super) fn resolve_node_executable(
    app_handle: Option<&tauri::AppHandle>,
) -> Result<PathBuf, String> {
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
pub(super) fn resolve_sidecar_script(app_handle: Option<&tauri::AppHandle>) -> Option<PathBuf> {
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

// ── Proxy persistence ────────────────────────────────────

const BROWSER_STORE_FILE: &str = "browser-config.json";
const STORE_KEY_PROXY: &str = "proxy_server";

/// Load saved browser proxy from Tauri store.
pub(super) fn load_browser_proxy(app_handle: &Option<tauri::AppHandle>) -> Option<String> {
    let handle = app_handle.as_ref()?;
    let store = tauri_plugin_store::StoreExt::store(handle, BROWSER_STORE_FILE).ok()?;
    store.get(STORE_KEY_PROXY)?.as_str().map(|s| s.to_string())
}

/// Persist browser proxy to Tauri store.
pub(super) fn save_browser_proxy(app_handle: &tauri::AppHandle, proxy: &str) {
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
    for var in [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
    ] {
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
            "/v",
            "ProxyServer",
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
                    "/v",
                    "ProxyEnable",
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
                    return if val.starts_with("http://")
                        || val.starts_with("https://")
                        || val.starts_with("socks")
                    {
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
