use crate::db::{agent_operations, operations, Database};
use crate::utils::config_helpers::{agents_dir, app_data_dir};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri_plugin_store::StoreExt;

const CREDENTIALS_META_FILE: &str = "credentials_meta.json";
const CREDENTIALS_SECRETS_STORE: &str = "credentials-secrets.json";

// ── Data model ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMeta {
    pub id: String,
    pub name: String,
    /// User-provided description explaining the credential's purpose (e.g., "GitHub API access for repo management")
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub allowed_hosts: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ── Metadata persistence (JSON file in app_data_dir) ──

fn meta_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_data_dir(app)?.join(CREDENTIALS_META_FILE))
}

fn load_all_meta(app: &tauri::AppHandle) -> Result<Vec<CredentialMeta>, String> {
    let path = meta_path(app)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let data = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read credentials metadata: {}", e))?;
    serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse credentials metadata: {}", e))
}

fn save_all_meta(app: &tauri::AppHandle, metas: &[CredentialMeta]) -> Result<(), String> {
    let path = meta_path(app)?;
    let data = serde_json::to_string_pretty(metas)
        .map_err(|e| format!("Failed to serialize credentials metadata: {}", e))?;
    std::fs::write(&path, data)
        .map_err(|e| format!("Failed to write credentials metadata: {}", e))
}

// ── Secret storage (tauri-plugin-store) ──
// Note: Secrets are stored via tauri-plugin-store for consistency with existing
// API key storage. For stronger at-rest protection, migrate to OS keychain
// or tauri-plugin-stronghold in the future.

fn store_secret(app: &tauri::AppHandle, id: &str, value: &str) -> Result<(), String> {
    let store = app
        .store(CREDENTIALS_SECRETS_STORE)
        .map_err(|e| format!("Failed to open credentials store: {}", e))?;
    store.set(id, serde_json::json!(value));
    store
        .save()
        .map_err(|e| format!("Failed to persist credentials store: {}", e))
}

pub fn get_secret(app: &tauri::AppHandle, id: &str) -> Result<String, String> {
    let store = app
        .store(CREDENTIALS_SECRETS_STORE)
        .map_err(|e| format!("Failed to open credentials store: {}", e))?;
    store
        .get(id)
        .and_then(|v| v.as_str().map(|s| s.to_string()))
        .ok_or_else(|| format!("Secret not found for credential '{}'", id))
}

fn remove_secret(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let store = app
        .store(CREDENTIALS_SECRETS_STORE)
        .map_err(|e| format!("Failed to open credentials store: {}", e))?;
    store.delete(id);
    store
        .save()
        .map_err(|e| format!("Failed to persist credentials store: {}", e))
}

// ── CRUD operations ──

pub fn list_credentials(app: &tauri::AppHandle) -> Result<Vec<CredentialMeta>, String> {
    load_all_meta(app)
}

pub fn add_credential(
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
    value: &str,
    description: &str,
    allowed_hosts: Vec<String>,
) -> Result<CredentialMeta, String> {
    if id.is_empty() {
        return Err("Credential ID must not be empty".into());
    }
    if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err("Credential ID must only contain letters, numbers, hyphens, and underscores".into());
    }

    let mut metas = load_all_meta(app)?;
    if metas.iter().any(|m| m.id == id) {
        return Err(format!("Credential '{}' already exists", id));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let meta = CredentialMeta {
        id: id.to_string(),
        name: name.to_string(),
        description: description.to_string(),
        allowed_hosts,
        created_at: now.clone(),
        updated_at: now,
    };

    // Store secret first; if this fails, don't save metadata
    store_secret(app, id, value)?;

    metas.push(meta.clone());
    save_all_meta(app, &metas)?;
    Ok(meta)
}

pub fn update_credential(
    app: &tauri::AppHandle,
    id: &str,
    name: Option<&str>,
    value: Option<&str>,
    description: Option<&str>,
    allowed_hosts: Option<Vec<String>>,
) -> Result<CredentialMeta, String> {
    let mut metas = load_all_meta(app)?;
    let meta = metas
        .iter_mut()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("Credential '{}' not found", id))?;

    if let Some(n) = name {
        meta.name = n.to_string();
    }
    if let Some(d) = description {
        meta.description = d.to_string();
    }
    if let Some(hosts) = allowed_hosts {
        meta.allowed_hosts = hosts;
    }
    meta.updated_at = chrono::Utc::now().to_rfc3339();

    if let Some(v) = value {
        store_secret(app, id, v)?;
    }

    let result = meta.clone();
    save_all_meta(app, &metas)?;
    Ok(result)
}

pub fn remove_credential(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    let mut metas = load_all_meta(app)?;
    let len_before = metas.len();
    metas.retain(|m| m.id != id);
    if metas.len() == len_before {
        return Err(format!("Credential '{}' not found", id));
    }

    // Remove secret (non-fatal if already gone)
    let _ = remove_secret(app, id);

    save_all_meta(app, &metas)
}

/// Returns (id, value) pairs for all stored credentials.
/// Used for redaction — never expose values to frontend.
pub fn get_all_secret_values(
    app: &tauri::AppHandle,
) -> Result<Vec<(String, String)>, String> {
    let metas = load_all_meta(app)?;
    let mut pairs = Vec::new();
    for meta in &metas {
        if let Ok(value) = get_secret(app, &meta.id) {
            pairs.push((meta.id.clone(), value));
        }
    }
    Ok(pairs)
}

// ── Multi-encoding redaction ──

/// Replace credential values in output with "[CREDENTIAL:{id} REDACTED]".
/// Checks exact, URL-encoded, base64, and JSON-escaped variants.
pub fn redact_output(output: &str, credentials: &[(String, String)]) -> String {
    let mut result = output.to_string();

    for (id, value) in credentials {
        if value.is_empty() {
            continue;
        }

        let replacement = format!("[CREDENTIAL:{} REDACTED]", id);

        // 1. Exact match
        result = result.replace(value, &replacement);

        // 2. URL-encoded
        let url_encoded = urlencoding::encode(value);
        if url_encoded.as_ref() != value {
            result = result.replace(url_encoded.as_ref(), &replacement);
        }

        // 3. Base64
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(value.as_bytes());
        result = result.replace(&b64, &replacement);

        // Also check URL-safe base64
        let b64_urlsafe =
            base64::engine::general_purpose::URL_SAFE.encode(value.as_bytes());
        if b64_urlsafe != b64 {
            result = result.replace(&b64_urlsafe, &replacement);
        }

        // 4. JSON-escaped (handles \n, \t, \", \\, unicode escapes)
        if let Ok(json_str) = serde_json::to_string(value) {
            // Strip surrounding quotes
            if json_str.len() > 2 {
                let inner = &json_str[1..json_str.len() - 1];
                if inner != value {
                    result = result.replace(inner, &replacement);
                }
            }
        }
    }

    result
}

/// Recursively scrub all string values in a JSON messages array.
pub fn scrub_messages(
    messages: &mut [serde_json::Value],
    credentials: &[(String, String)],
) {
    if credentials.is_empty() {
        return;
    }
    for msg in messages.iter_mut() {
        scrub_value(msg, credentials);
    }
}

fn scrub_value(value: &mut serde_json::Value, credentials: &[(String, String)]) {
    match value {
        serde_json::Value::String(s) => {
            *s = redact_output(s, credentials);
        }
        serde_json::Value::Array(arr) => {
            for item in arr.iter_mut() {
                scrub_value(item, credentials);
            }
        }
        serde_json::Value::Object(map) => {
            for (_, v) in map.iter_mut() {
                scrub_value(v, credentials);
            }
        }
        _ => {}
    }
}

// ── Agent credential access control ──

/// Resolved credential entry for environment variable injection.
#[derive(Debug, Clone)]
pub struct CredentialEnvEntry {
    /// Original credential ID (used in redaction messages)
    pub id: String,
    /// Environment variable name (e.g., CRED_GITHUB_TOKEN)
    pub env_name: String,
    /// Actual secret value
    pub value: String,
}

/// Convert a credential ID to an environment variable name.
/// Rules: `CRED_` prefix + uppercase + hyphens/spaces become underscores + strip non-alphanumeric.
///
/// Examples:
/// - `"github-token"` → `"CRED_GITHUB_TOKEN"`
/// - `"openai_api_key"` → `"CRED_OPENAI_API_KEY"`
pub fn credential_id_to_env_var(id: &str) -> String {
    let normalized: String = id
        .to_uppercase()
        .replace('-', "_")
        .replace(' ', "_")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    format!("CRED_{}", normalized)
}

/// Parse the `credentials` section of a TOOL_CONFIG.json value
/// and return the set of allowed credential IDs.
pub fn parse_allowed_credentials(config: &serde_json::Value) -> HashSet<String> {
    let mut allowed = HashSet::new();
    if let Some(creds) = config["credentials"].as_object() {
        for (id, val) in creds {
            // Support both { "allowed": true } (v2 object) and bare true (legacy)
            let is_allowed = val
                .as_object()
                .and_then(|o| o.get("allowed"))
                .and_then(|v| v.as_bool())
                .or_else(|| val.as_bool())
                .unwrap_or(false);
            if is_allowed {
                allowed.insert(id.clone());
            }
        }
    }
    allowed
}

/// Read TOOL_CONFIG.json for an agent directory and return allowed credential IDs.
pub fn read_allowed_credentials_from_dir(agent_dir: &Path) -> Result<HashSet<String>, String> {
    let config_path = agent_dir.join("TOOL_CONFIG.json");
    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(HashSet::new()),
    };
    let config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Invalid TOOL_CONFIG.json: {}", e))?;
    Ok(parse_allowed_credentials(&config))
}

/// Get the set of credential IDs this agent is allowed to use, resolved from conversation.
pub fn get_agent_allowed_credentials(
    app: &tauri::AppHandle,
    db: &Database,
    conversation_id: &str,
) -> Result<HashSet<String>, String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;
    let agent = agent_operations::get_agent_impl(db, conv.agent_id)
        .map_err(|e| format!("Failed to get agent: {}", e))?;
    let agents_dir = agents_dir(app)?;
    let agent_dir = agents_dir.join(&agent.folder_name);
    read_allowed_credentials_from_dir(&agent_dir)
}

/// Get the set of credential IDs this agent is allowed to use, resolved from agent_id directly.
/// Used by cron jobs and other backend-triggered tool calls.
pub fn get_agent_allowed_credentials_by_agent_id(
    app: &tauri::AppHandle,
    db: &Database,
    agent_id: &str,
) -> Result<HashSet<String>, String> {
    let agent = agent_operations::get_agent_impl(db, agent_id.to_string())
        .map_err(|e| format!("Failed to get agent: {}", e))?;
    let agents_dir = agents_dir(app)?;
    let agent_dir = agents_dir.join(&agent.folder_name);
    read_allowed_credentials_from_dir(&agent_dir)
}

/// Resolve allowed credential IDs into `CredentialEnvEntry` items.
/// Returns an error if any two credential IDs map to the same environment variable name.
pub fn resolve_credential_env_entries(
    app: &tauri::AppHandle,
    allowed_ids: &HashSet<String>,
) -> Result<Vec<CredentialEnvEntry>, String> {
    let mut entries = Vec::new();
    let mut env_name_to_id: HashMap<String, String> = HashMap::new();

    for id in allowed_ids {
        let env_name = credential_id_to_env_var(id);

        // Collision detection
        if let Some(existing_id) = env_name_to_id.get(&env_name) {
            return Err(format!(
                "Credential env var collision: '{}' and '{}' both map to '{}'",
                existing_id, id, env_name
            ));
        }
        env_name_to_id.insert(env_name.clone(), id.clone());

        let value = get_secret(app, id)?;
        entries.push(CredentialEnvEntry {
            id: id.clone(),
            env_name,
            value,
        });
    }

    Ok(entries)
}

// ── Browser credential placeholder resolution ──

/// Resolved text with credential pairs for redaction.
pub struct ResolvedText {
    pub text: String,
    pub credential_pairs: Vec<(String, String)>,
}

/// Strict credential ID pattern: [A-Za-z0-9_-]+
const CREDENTIAL_ID_CHARS: &str = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";

/// Check if text contains any `{{credential:ID}}` placeholder.
pub fn contains_credential_placeholder(text: &str) -> bool {
    let prefix = "{{credential:";
    let suffix = "}}";
    let mut pos = 0;
    while let Some(start) = text[pos..].find(prefix) {
        let id_start = pos + start + prefix.len();
        if id_start >= text.len() {
            break;
        }
        if let Some(end) = text[id_start..].find(suffix) {
            let id = &text[id_start..id_start + end];
            if !id.is_empty() && id.chars().all(|c| CREDENTIAL_ID_CHARS.contains(c)) {
                return true;
            }
            pos = id_start + end + suffix.len();
        } else {
            break;
        }
    }
    false
}

/// Resolve `{{credential:ID}}` placeholders in text.
/// Returns the resolved text and credential pairs for later redaction.
/// Errors if a referenced credential is not in the allowed set or secret is missing.
pub fn resolve_credential_placeholders(
    app: &tauri::AppHandle,
    text: &str,
    allowed_ids: &HashSet<String>,
) -> Result<ResolvedText, String> {
    let prefix = "{{credential:";
    let suffix = "}}";
    let mut result = String::with_capacity(text.len());
    let mut pairs = Vec::new();
    let mut pos = 0;

    while let Some(start) = text[pos..].find(prefix) {
        let abs_start = pos + start;
        let id_start = abs_start + prefix.len();
        if id_start >= text.len() {
            result.push_str(&text[pos..]);
            break;
        }
        if let Some(end) = text[id_start..].find(suffix) {
            let id = &text[id_start..id_start + end];
            if !id.is_empty() && id.chars().all(|c| CREDENTIAL_ID_CHARS.contains(c)) {
                if !allowed_ids.contains(id) {
                    return Err(format!(
                        "Agent does not have access to credential '{}'",
                        id
                    ));
                }
                let value = get_secret(app, id)?;
                result.push_str(&text[pos..abs_start]);
                result.push_str(&value);
                pairs.push((id.to_string(), value));
                pos = id_start + end + suffix.len();
            } else {
                // Invalid ID chars — not a valid placeholder, keep as-is
                result.push_str(&text[pos..id_start + end + suffix.len()]);
                pos = id_start + end + suffix.len();
            }
        } else {
            // No closing }} — keep as-is
            result.push_str(&text[pos..]);
            pos = text.len();
        }
    }

    if pos < text.len() {
        result.push_str(&text[pos..]);
    }

    Ok(ResolvedText {
        text: result,
        credential_pairs: pairs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── credential_id_to_env_var ──

    #[test]
    fn test_env_var_basic() {
        assert_eq!(credential_id_to_env_var("github-token"), "CRED_GITHUB_TOKEN");
    }

    #[test]
    fn test_env_var_underscores() {
        assert_eq!(credential_id_to_env_var("openai_api_key"), "CRED_OPENAI_API_KEY");
    }

    #[test]
    fn test_env_var_spaces() {
        assert_eq!(credential_id_to_env_var("my api key"), "CRED_MY_API_KEY");
    }

    #[test]
    fn test_env_var_mixed() {
        assert_eq!(credential_id_to_env_var("slack-webhook_url"), "CRED_SLACK_WEBHOOK_URL");
    }

    #[test]
    fn test_env_var_strips_special() {
        assert_eq!(credential_id_to_env_var("key@123!"), "CRED_KEY123");
    }

    #[test]
    fn test_env_var_collision_detection() {
        // foo-bar and foo_bar both map to CRED_FOO_BAR
        assert_eq!(credential_id_to_env_var("foo-bar"), credential_id_to_env_var("foo_bar"));
    }

    // ── parse_allowed_credentials ──

    #[test]
    fn test_parse_allowed_credentials_v2() {
        let config = serde_json::json!({
            "credentials": {
                "github-token": { "allowed": true },
                "disabled-key": { "allowed": false }
            }
        });
        let allowed = parse_allowed_credentials(&config);
        assert!(allowed.contains("github-token"));
        assert!(!allowed.contains("disabled-key"));
    }

    #[test]
    fn test_parse_allowed_credentials_legacy() {
        let config = serde_json::json!({
            "credentials": {
                "github-token": true,
                "disabled-key": false
            }
        });
        let allowed = parse_allowed_credentials(&config);
        assert!(allowed.contains("github-token"));
        assert!(!allowed.contains("disabled-key"));
    }

    #[test]
    fn test_parse_allowed_credentials_empty() {
        let config = serde_json::json!({ "credentials": {} });
        let allowed = parse_allowed_credentials(&config);
        assert!(allowed.is_empty());
    }

    #[test]
    fn test_parse_allowed_credentials_missing_section() {
        let config = serde_json::json!({ "native": {} });
        let allowed = parse_allowed_credentials(&config);
        assert!(allowed.is_empty());
    }

    // ── credential ID validation ──

    #[test]
    fn test_add_credential_rejects_special_chars() {
        // Can't test add_credential directly without AppHandle, but we can test the regex logic
        let valid_chars = |id: &str| -> bool {
            !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        };
        assert!(valid_chars("github-token"));
        assert!(valid_chars("api_key_123"));
        assert!(!valid_chars("key with spaces"));
        assert!(!valid_chars("key@special"));
        assert!(!valid_chars("key}brace"));
        assert!(!valid_chars(""));
    }

    // ── contains_credential_placeholder ──

    #[test]
    fn test_contains_placeholder_positive() {
        assert!(contains_credential_placeholder("{{credential:github-token}}"));
    }

    #[test]
    fn test_contains_placeholder_in_text() {
        assert!(contains_credential_placeholder("Bearer {{credential:api-key}}"));
    }

    #[test]
    fn test_contains_placeholder_negative() {
        assert!(!contains_credential_placeholder("no placeholders here"));
    }

    #[test]
    fn test_contains_placeholder_incomplete() {
        assert!(!contains_credential_placeholder("{{credential:incomplete"));
    }

    #[test]
    fn test_contains_placeholder_empty_id() {
        assert!(!contains_credential_placeholder("{{credential:}}"));
    }

    #[test]
    fn test_contains_placeholder_special_chars_in_id() {
        // IDs with special chars should NOT match the strict pattern
        assert!(!contains_credential_placeholder("{{credential:key@bad}}"));
        assert!(!contains_credential_placeholder("{{credential:key with space}}"));
    }

    // ── redact_output ──

    #[test]
    fn test_redact_exact() {
        let creds = vec![("api_key".to_string(), "sk-secret123".to_string())];
        let output = "Authorization: Bearer sk-secret123";
        let result = redact_output(output, &creds);
        assert_eq!(
            result,
            "Authorization: Bearer [CREDENTIAL:api_key REDACTED]"
        );
    }

    #[test]
    fn test_redact_url_encoded() {
        let creds = vec![("key".to_string(), "a b+c".to_string())];
        let output = "param=a%20b%2Bc";
        let result = redact_output(output, &creds);
        assert!(result.contains("[CREDENTIAL:key REDACTED]"));
    }

    #[test]
    fn test_redact_base64() {
        use base64::Engine;
        let secret = "my-secret-value";
        let b64 = base64::engine::general_purpose::STANDARD.encode(secret.as_bytes());
        let creds = vec![("key".to_string(), secret.to_string())];
        let output = format!("encoded: {}", b64);
        let result = redact_output(&output, &creds);
        assert!(result.contains("[CREDENTIAL:key REDACTED]"));
        assert!(!result.contains(&b64));
    }

    #[test]
    fn test_redact_json_escaped() {
        let creds = vec![("key".to_string(), "line1\nline2".to_string())];
        let output = r#"{"value":"line1\nline2"}"#;
        let result = redact_output(output, &creds);
        assert!(result.contains("[CREDENTIAL:key REDACTED]"));
    }

    #[test]
    fn test_redact_empty_value_skipped() {
        let creds = vec![("key".to_string(), String::new())];
        let output = "nothing to redact here";
        let result = redact_output(output, &creds);
        assert_eq!(result, output);
    }

    // ── scrub_messages ──

    #[test]
    fn test_scrub_messages_basic() {
        let creds = vec![("key".to_string(), "secret".to_string())];
        let mut messages = vec![serde_json::json!({
            "role": "assistant",
            "content": "The secret is secret"
        })];
        scrub_messages(&mut messages, &creds);
        let content = messages[0]["content"].as_str().unwrap();
        assert!(content.contains("[CREDENTIAL:key REDACTED]"));
        assert!(!content.contains("secret"));
    }

    #[test]
    fn test_scrub_messages_nested_array() {
        let creds = vec![("k".to_string(), "val".to_string())];
        let mut messages = vec![serde_json::json!({
            "content": [{"text": "has val inside"}]
        })];
        scrub_messages(&mut messages, &creds);
        let text = messages[0]["content"][0]["text"].as_str().unwrap();
        assert!(text.contains("[CREDENTIAL:k REDACTED]"));
    }

    #[test]
    fn test_scrub_messages_empty_credentials() {
        let creds: Vec<(String, String)> = Vec::new();
        let mut messages = vec![serde_json::json!({"content": "unchanged"})];
        let original = messages[0].clone();
        scrub_messages(&mut messages, &creds);
        assert_eq!(messages[0], original);
    }

}
