//! Community Hub HTTP client — talks to the relay-server REST API.
//!
//! Converts the relay WebSocket URL into the Hub REST base URL and provides
//! typed wrappers around every Hub API endpoint.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri_plugin_store::StoreExt;
use wa_shared::community::*;

const STORE_HUB_AUTH: &str = "hub-auth.json";

// ── Hub auth persistence ────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
pub struct HubAuth {
    pub token: String,
    pub user_id: String,
    pub email: String,
    pub display_name: String,
}

impl std::fmt::Debug for HubAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("HubAuth")
            .field("token", &"[REDACTED]")
            .field("user_id", &self.user_id)
            .field("email", &self.email)
            .field("display_name", &self.display_name)
            .finish()
    }
}

pub fn save_hub_auth(
    app: &tauri::AppHandle,
    token: &str,
    user_id: &str,
    email: &str,
    display_name: &str,
) -> Result<(), AppError> {
    let store = app
        .store(STORE_HUB_AUTH)
        .map_err(|e| AppError::Config(format!("Failed to open hub-auth store: {e}")))?;
    store.set("token", serde_json::json!(token));
    store.set("user_id", serde_json::json!(user_id));
    store.set("email", serde_json::json!(email));
    store.set("display_name", serde_json::json!(display_name));
    store
        .save()
        .map_err(|e| AppError::Config(format!("Failed to persist hub-auth: {e}")))?;
    Ok(())
}

pub fn load_hub_auth(app: &tauri::AppHandle) -> Option<HubAuth> {
    let store = app.store(STORE_HUB_AUTH).ok()?;
    let token = store.get("token")?.as_str()?.to_string();
    if token.is_empty() {
        return None;
    }
    let user_id = store.get("user_id")?.as_str()?.to_string();
    let email = store.get("email")?.as_str()?.to_string();
    let display_name = store
        .get("display_name")
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default();
    Some(HubAuth {
        token,
        user_id,
        email,
        display_name,
    })
}

pub fn clear_hub_auth(app: &tauri::AppHandle) -> Result<(), AppError> {
    let store = app
        .store(STORE_HUB_AUTH)
        .map_err(|e| AppError::Config(format!("Failed to open hub-auth store: {e}")))?;
    store.clear();
    store
        .save()
        .map_err(|e| AppError::Config(format!("Failed to persist hub-auth clear: {e}")))?;
    Ok(())
}

// ── URL conversion ──────────────────────────────────────

/// Convert a relay WebSocket URL to the Hub REST API base URL.
///
/// `wss://relay.windowagent.io/ws` → `https://relay.windowagent.io`
/// `ws://localhost:3000/ws`        → `http://localhost:3000`
pub fn hub_base_url(relay_url: &str) -> String {
    let url = if let Some(rest) = relay_url.strip_prefix("wss://") {
        format!("https://{rest}")
    } else if let Some(rest) = relay_url.strip_prefix("ws://") {
        format!("http://{rest}")
    } else {
        relay_url.to_string()
    };
    let url = url.trim_end_matches('/');
    url.strip_suffix("/ws").unwrap_or(url).to_string()
}

// ── HubClient ───────────────────────────────────────────

pub struct HubClient {
    client: reqwest::Client,
    base_url: String,
    token: Option<String>,
}

/// Server error body used to extract error messages from non-2xx responses.
#[derive(Deserialize)]
struct ServerError {
    error: String,
}

impl HubClient {
    pub fn new(relay_url: &str, token: Option<String>) -> Self {
        // Hub API targets an internal relay server — always bypass proxy.
        Self {
            client: crate::utils::http::build_no_proxy_client(),
            base_url: hub_base_url(relay_url),
            token,
        }
    }

    /// Validate a resource ID to prevent path traversal or empty IDs.
    fn validate_id(id: &str) -> Result<(), AppError> {
        if id.is_empty() || id.contains('/') || id.contains("..") {
            return Err(AppError::Validation(format!("Invalid resource id: {id}")));
        }
        Ok(())
    }

    /// Build a request with optional Bearer auth.
    fn authed(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if let Some(ref token) = self.token {
            builder.bearer_auth(token)
        } else {
            builder
        }
    }

    /// Extract a friendly error message from a non-2xx response.
    async fn extract_error(resp: reqwest::Response) -> AppError {
        let status = resp.status();
        match resp.json::<ServerError>().await {
            Ok(body) => AppError::Api(format!("[{status}] {}", body.error)),
            Err(_) => AppError::Api(format!("Hub API returned {status}")),
        }
    }

    // ── Auth ──

    pub async fn register(
        &self,
        email: &str,
        password: &str,
        display_name: Option<&str>,
    ) -> Result<AuthResponse, AppError> {
        let body = RegisterRequest {
            email: email.to_string(),
            password: password.to_string(),
            display_name: display_name.map(String::from),
        };
        let resp = self
            .client
            .post(format!("{}/api/auth/register", self.base_url))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn login(&self, email: &str, password: &str) -> Result<AuthResponse, AppError> {
        let body = LoginRequest {
            email: email.to_string(),
            password: password.to_string(),
        };
        let resp = self
            .client
            .post(format!("{}/api/auth/login", self.base_url))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    // ── Profile ──

    pub async fn get_me(&self) -> Result<UserInfo, AppError> {
        let resp = self
            .authed(self.client.get(format!("{}/api/me", self.base_url)))
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn update_me(
        &self,
        display_name: Option<&str>,
        peer_id: Option<&str>,
    ) -> Result<UserInfo, AppError> {
        let body = UpdateMeRequest {
            display_name: display_name.map(String::from),
            peer_id: peer_id.map(String::from),
        };
        let resp = self
            .authed(self.client.post(format!("{}/api/me", self.base_url)))
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    // ── Share ──

    pub async fn share_agent(
        &self,
        name: &str,
        description: &str,
        original_agent_id: Option<&str>,
        persona: Option<PersonaData>,
    ) -> Result<SharedAgent, AppError> {
        let body = ShareAgentRequest {
            name: name.to_string(),
            description: description.to_string(),
            original_agent_id: original_agent_id.map(String::from),
            persona,
        };
        let resp = self
            .authed(
                self.client
                    .post(format!("{}/api/share/agent", self.base_url)),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn share_skills(
        &self,
        agent_id: Option<&str>,
        skills: Vec<ShareSkillItem>,
    ) -> Result<Vec<SharedSkill>, AppError> {
        let body = ShareSkillsRequest {
            agent_id: agent_id.map(String::from),
            skills,
        };
        let resp = self
            .authed(
                self.client
                    .post(format!("{}/api/share/skills", self.base_url)),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn share_notes(
        &self,
        agent_id: Option<&str>,
        notes: Vec<ShareNoteItem>,
    ) -> Result<Vec<SharedNote>, AppError> {
        let body = ShareNotesRequest {
            agent_id: agent_id.map(String::from),
            notes,
        };
        let resp = self
            .authed(
                self.client
                    .post(format!("{}/api/share/notes", self.base_url)),
            )
            .json(&body)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    // ── List (public) ──

    pub async fn list_agents(
        &self,
        q: Option<&str>,
        user_id: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<PaginatedResponse<SharedAgent>, AppError> {
        let mut params = Vec::new();
        if let Some(q) = q {
            params.push(("q", q.to_string()));
        }
        if let Some(user_id) = user_id {
            params.push(("user_id", user_id.to_string()));
        }
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        if let Some(offset) = offset {
            params.push(("offset", offset.to_string()));
        }
        let resp = self
            .client
            .get(format!("{}/api/shared/agents", self.base_url))
            .query(&params)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn list_skills(
        &self,
        q: Option<&str>,
        agent_id: Option<&str>,
        user_id: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<PaginatedResponse<SharedSkill>, AppError> {
        let mut params = Vec::new();
        if let Some(q) = q {
            params.push(("q", q.to_string()));
        }
        if let Some(agent_id) = agent_id {
            params.push(("agent_id", agent_id.to_string()));
        }
        if let Some(user_id) = user_id {
            params.push(("user_id", user_id.to_string()));
        }
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        if let Some(offset) = offset {
            params.push(("offset", offset.to_string()));
        }
        let resp = self
            .client
            .get(format!("{}/api/shared/skills", self.base_url))
            .query(&params)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    pub async fn list_notes(
        &self,
        q: Option<&str>,
        agent_id: Option<&str>,
        user_id: Option<&str>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<PaginatedResponse<SharedNote>, AppError> {
        let mut params = Vec::new();
        if let Some(q) = q {
            params.push(("q", q.to_string()));
        }
        if let Some(agent_id) = agent_id {
            params.push(("agent_id", agent_id.to_string()));
        }
        if let Some(user_id) = user_id {
            params.push(("user_id", user_id.to_string()));
        }
        if let Some(limit) = limit {
            params.push(("limit", limit.to_string()));
        }
        if let Some(offset) = offset {
            params.push(("offset", offset.to_string()));
        }
        let resp = self
            .client
            .get(format!("{}/api/shared/notes", self.base_url))
            .query(&params)
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(resp.json().await?)
    }

    // ── Delete (auth required) ──

    pub async fn delete_agent(&self, id: &str) -> Result<(), AppError> {
        Self::validate_id(id)?;
        let resp = self
            .authed(
                self.client
                    .delete(format!("{}/api/shared/agents/{}", self.base_url, id)),
            )
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(())
    }

    pub async fn delete_skill(&self, id: &str) -> Result<(), AppError> {
        Self::validate_id(id)?;
        let resp = self
            .authed(
                self.client
                    .delete(format!("{}/api/shared/skills/{}", self.base_url, id)),
            )
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(())
    }

    pub async fn delete_note(&self, id: &str) -> Result<(), AppError> {
        Self::validate_id(id)?;
        let resp = self
            .authed(
                self.client
                    .delete(format!("{}/api/shared/notes/{}", self.base_url, id)),
            )
            .send()
            .await?;
        if !resp.status().is_success() {
            return Err(Self::extract_error(resp).await);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hub_base_url_wss() {
        assert_eq!(
            hub_base_url("wss://relay.windowagent.io/ws"),
            "https://relay.windowagent.io"
        );
    }

    #[test]
    fn test_hub_base_url_ws() {
        assert_eq!(
            hub_base_url("ws://localhost:3000/ws"),
            "http://localhost:3000"
        );
    }

    #[test]
    fn test_hub_base_url_no_ws_path() {
        assert_eq!(
            hub_base_url("wss://relay.example.com"),
            "https://relay.example.com"
        );
    }

    #[test]
    fn test_hub_base_url_trailing_slash() {
        assert_eq!(
            hub_base_url("wss://relay.example.com/ws/"),
            "https://relay.example.com"
        );
    }
}
