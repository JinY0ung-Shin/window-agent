use super::BrowserManager;
use super::screenshot::BrowserToolResult;

impl BrowserManager {
    /// Navigate to URL
    pub async fn navigate(
        &self,
        conversation_id: &str,
        url: &str,
    ) -> Result<BrowserToolResult, String> {
        let session_id = self.get_or_create_session(conversation_id).await?;

        // Validate URL security (read-only check)
        {
            let sessions = self.sessions.read().await;
            if let Some(session) = sessions.get(conversation_id) {
                super::security::validate_url(url, &session.security_policy)?;
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

    /// Type text into element by ref number.
    /// `allow_password`: when true, skip the password field check (for credential injection).
    /// `skip_screenshot`: when true, suppress screenshot capture (prevent visual credential leakage).
    pub async fn type_text(
        &self,
        conversation_id: &str,
        ref_num: u32,
        text: &str,
        allow_password: bool,
        skip_screenshot: bool,
    ) -> Result<BrowserToolResult, String> {
        // Check if target is password field (read-only check)
        if !allow_password {
            let sessions = self.sessions.read().await;
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
                serde_json::json!({
                    "ref": ref_num,
                    "text": text,
                    "allow_password": allow_password,
                    "skip_screenshot": skip_screenshot,
                }),
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
}
