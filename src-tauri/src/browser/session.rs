use std::collections::{HashMap, HashSet};

use super::{BrowserManager, BrowserSession, SessionSecurityPolicy};

// ── Session lifecycle methods ────────────────────────────

impl BrowserManager {
    /// Get or create a session for a conversation.
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

    /// Close a session for a conversation.
    pub async fn close_session(&self, conversation_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.remove(conversation_id) {
            let session_id = session.session_id.clone();
            drop(sessions); // release lock before async call
            let _ = self
                .send_command("close_session", &session_id, serde_json::json!({}))
                .await;
        }
        Ok(())
    }

    /// Approve a domain for a conversation's session (called from frontend via Tauri command).
    /// If the session doesn't exist yet, stores as pending and applies when session is created.
    pub async fn approve_domain(&self, conversation_id: &str, domain: &str) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(conversation_id) {
            session
                .security_policy
                .approved_domains
                .insert(domain.to_string());
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

    /// Update session state from a sidecar response.
    pub(crate) async fn update_session_from_response(
        &self,
        conversation_id: &str,
        resp: &super::SidecarResponse,
    ) -> Result<(), String> {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(conversation_id) {
            // Validate final URL against security policy
            super::security::validate_response_url(resp, &session.security_policy)?;

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

    /// Get the current browser headless setting.
    pub async fn get_headless(&self) -> bool {
        *self.headless.lock().await
    }

    /// Set browser headless mode and restart sidecar to apply.
    pub async fn set_headless(&self, headless: bool) {
        *self.headless.lock().await = headless;

        // Kill existing sidecar so it restarts with new setting on next use
        let mut sidecar = self.sidecar.lock().await;
        if let Some(mut s) = sidecar.take() {
            let _ = s.child.kill();
        }

        // Clear all cached sessions
        {
            let mut sessions = self.sessions.write().await;
            sessions.clear();
        }

        // Persist to Tauri store
        if let Some(ref handle) = self.app_handle {
            super::sidecar::save_browser_headless(handle, headless);
        }
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

        // Clear all cached sessions — they belong to the old sidecar process
        // and will fail with "Session not found" in the new sidecar.
        {
            let mut sessions = self.sessions.write().await;
            sessions.clear();
        }

        // Persist to Tauri store
        if let Some(ref handle) = self.app_handle {
            super::sidecar::save_browser_proxy(handle, &proxy);
        }
    }
}
