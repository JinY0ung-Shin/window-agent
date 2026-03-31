use serde::Serialize;

use super::{BrowserManager, SidecarResponse};

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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tabs: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub eval_result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dialog: Option<serde_json::Value>,
}

impl BrowserManager {
    pub(crate) fn build_tool_result(&self, resp: &SidecarResponse) -> Result<BrowserToolResult, String> {
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
        let screenshot_path = resp.screenshot.as_ref()
            .and_then(|b64| self.save_screenshot(&artifact_id, b64).ok());

        Ok(BrowserToolResult {
            success: true,
            url: resp.url.clone().unwrap_or_default(),
            title: resp.title.clone().unwrap_or_default(),
            snapshot,
            snapshot_full,
            element_count: resp.element_count.unwrap_or(0),
            artifact_id,
            screenshot_path,
            tabs: resp.tabs.clone(),
            eval_result: resp.eval_result.clone(),
            dialog: resp.dialog.clone(),
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

#[cfg(test)]
mod tests {
    use super::*;

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
            tabs: None,
            eval_result: None,
            dialog: None,
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
            tabs: None,
            eval_result: None,
            dialog: None,
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
            tabs: None,
            eval_result: None,
            dialog: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert!(result.snapshot.contains("truncated"));
        // Should not panic and should be valid UTF-8
        assert!(result.snapshot.is_char_boundary(0));
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
            tabs: None,
            eval_result: None,
            dialog: None,
        };
        let result = manager.build_tool_result(&resp).unwrap();
        assert!(!result.artifact_id.is_empty());
        assert!(result.screenshot_path.is_none());
    }
}
