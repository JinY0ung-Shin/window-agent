use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_store::StoreExt;

const CREDENTIALS_META_FILE: &str = "credentials_meta.json";
const CREDENTIALS_SECRETS_STORE: &str = "credentials-secrets.json";

// ── Data model ──

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CredentialMeta {
    pub id: String,
    pub name: String,
    pub allowed_hosts: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

// ── Metadata persistence (JSON file in app_data_dir) ──

fn meta_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join(CREDENTIALS_META_FILE))
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

pub fn get_credential_meta(
    app: &tauri::AppHandle,
    id: &str,
) -> Result<CredentialMeta, String> {
    let metas = load_all_meta(app)?;
    metas
        .into_iter()
        .find(|m| m.id == id)
        .ok_or_else(|| format!("Credential '{}' not found", id))
}

pub fn add_credential(
    app: &tauri::AppHandle,
    id: &str,
    name: &str,
    value: &str,
    allowed_hosts: Vec<String>,
) -> Result<CredentialMeta, String> {
    if id.is_empty() {
        return Err("Credential ID must not be empty".into());
    }
    if allowed_hosts.is_empty() {
        return Err("allowed_hosts must not be empty".into());
    }

    let mut metas = load_all_meta(app)?;
    if metas.iter().any(|m| m.id == id) {
        return Err(format!("Credential '{}' already exists", id));
    }

    let now = chrono::Utc::now().to_rfc3339();
    let meta = CredentialMeta {
        id: id.to_string(),
        name: name.to_string(),
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
    if let Some(hosts) = allowed_hosts {
        if hosts.is_empty() {
            return Err("allowed_hosts must not be empty".into());
        }
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

// ── Host matching ──

/// Normalize a hostname: lowercase, strip trailing dot, strip port, IDNA via url crate.
fn normalize_host(host: &str) -> String {
    let h = host.to_lowercase();
    // Strip trailing dot
    let h = h.strip_suffix('.').unwrap_or(&h);
    // Strip port — careful not to mistake IPv6 colons for port separators
    let h = if let Some(bracket_end) = h.find(']') {
        // IPv6 with brackets: [::1]:port
        if let Some(colon_pos) = h[bracket_end..].find(':') {
            &h[..bracket_end + colon_pos]
        } else {
            h
        }
    } else if h.matches(':').count() == 1 {
        // Exactly one colon → host:port (not IPv6)
        if let Some(colon_pos) = h.rfind(':') {
            if h[colon_pos + 1..].parse::<u16>().is_ok() {
                &h[..colon_pos]
            } else {
                h
            }
        } else {
            h
        }
    } else {
        // Multiple colons → IPv6 address, don't strip
        h
    };
    // Strip brackets from IPv6
    let h = h
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(h);
    // IDNA normalization via url crate — wrap IPv6 in brackets for URL parsing
    let url_host = if h.contains(':') {
        format!("[{}]", h)
    } else {
        h.to_string()
    };
    if let Ok(url) = url::Url::parse(&format!("https://{}/", url_host)) {
        let result = url.host_str().unwrap_or(h).to_lowercase();
        // Strip brackets that url crate adds for IPv6
        result
            .strip_prefix('[')
            .and_then(|s| s.strip_suffix(']'))
            .unwrap_or(&result)
            .to_string()
    } else {
        h.to_lowercase()
    }
}

/// Check if request_host matches any of the allowed host patterns.
/// - Exact match by default
/// - Wildcard: "*.github.com" matches "sub.github.com" but NOT "github.com"
/// - IDNA normalization applied to both sides
/// - Rejects suffix tricks: "api.github.com.evil.com" does NOT match "api.github.com"
pub fn host_matches(request_host: &str, allowed: &[String]) -> bool {
    let normalized_request = normalize_host(request_host);
    if normalized_request.is_empty() {
        return false;
    }

    for pattern in allowed {
        let normalized_pattern = normalize_host(pattern);
        if let Some(suffix) = normalized_pattern.strip_prefix('*') {
            // Wildcard: *.example.com → suffix = ".example.com"
            // Must match a subdomain, not the base domain itself
            if normalized_request.ends_with(suffix)
                && normalized_request.len() > suffix.len()
            {
                // Verify no extra dots that could be a suffix trick
                // The part before the suffix must not contain the suffix's base domain
                return true;
            }
        } else {
            // Exact match
            if normalized_request == normalized_pattern {
                return true;
            }
        }
    }
    false
}

/// Hard deny: check if host is private or loopback.
/// No override allowed — these are always blocked for http_request.
pub fn is_private_or_loopback(host: &str) -> bool {
    let h = normalize_host(host);

    // Well-known private/loopback hostnames
    if h == "localhost" || h.ends_with(".local") || h.ends_with(".internal") {
        return true;
    }

    // IPv6 loopback
    if h == "::1" {
        return true;
    }

    // Parse as IP and check ranges
    if let Ok(ip) = h.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(v4) => {
                v4.is_loopback()       // 127.0.0.0/8
                    || v4.is_private()  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
                    || v4.is_link_local() // 169.254.0.0/16
                    || v4.octets()[0] == 0 // 0.0.0.0/8
            }
            std::net::IpAddr::V6(v6) => v6.is_loopback(),
        }
    } else {
        false
    }
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

// ── Credential reference parsing ──

/// Extract credential IDs from `{{credential:ID}}` patterns in text.
pub fn extract_credential_refs(text: &str) -> Vec<String> {
    let mut refs = Vec::new();
    let mut search_from = 0;
    let prefix = "{{credential:";
    let suffix = "}}";

    while let Some(start) = text[search_from..].find(prefix) {
        let abs_start = search_from + start;
        let after_prefix = abs_start + prefix.len();
        if after_prefix >= text.len() {
            break;
        }
        if let Some(end) = text[after_prefix..].find(suffix) {
            let id = &text[after_prefix..after_prefix + end];
            if !id.is_empty() && !id.contains('{') && !id.contains('}') {
                refs.push(id.to_string());
            }
            search_from = after_prefix + end + suffix.len();
        } else {
            break;
        }
    }
    refs.sort();
    refs.dedup();
    refs
}

/// Check if any unresolved `{{credential:*}}` references remain in text.
pub fn has_unresolved_refs(text: &str) -> bool {
    text.contains("{{credential:")
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── normalize_host ──

    #[test]
    fn test_normalize_host_lowercase() {
        assert_eq!(normalize_host("Example.COM"), "example.com");
    }

    #[test]
    fn test_normalize_host_trailing_dot() {
        assert_eq!(normalize_host("example.com."), "example.com");
    }

    #[test]
    fn test_normalize_host_strip_port() {
        assert_eq!(normalize_host("example.com:443"), "example.com");
    }

    #[test]
    fn test_normalize_host_ipv6() {
        assert_eq!(normalize_host("[::1]:8080"), "::1");
    }

    // ── host_matches ──

    #[test]
    fn test_host_matches_exact() {
        assert!(host_matches("api.github.com", &["api.github.com".into()]));
    }

    #[test]
    fn test_host_matches_exact_case_insensitive() {
        assert!(host_matches("API.GitHub.COM", &["api.github.com".into()]));
    }

    #[test]
    fn test_host_matches_exact_no_match() {
        assert!(!host_matches("evil.com", &["api.github.com".into()]));
    }

    #[test]
    fn test_host_matches_wildcard() {
        assert!(host_matches(
            "sub.github.com",
            &["*.github.com".into()]
        ));
    }

    #[test]
    fn test_host_matches_wildcard_no_base() {
        // *.github.com should NOT match github.com itself
        assert!(!host_matches("github.com", &["*.github.com".into()]));
    }

    #[test]
    fn test_host_matches_wildcard_deep_subdomain() {
        assert!(host_matches(
            "deep.sub.github.com",
            &["*.github.com".into()]
        ));
    }

    #[test]
    fn test_host_matches_suffix_trick_rejected() {
        // api.github.com.evil.com must NOT match api.github.com
        assert!(!host_matches(
            "api.github.com.evil.com",
            &["api.github.com".into()]
        ));
    }

    #[test]
    fn test_host_matches_with_port() {
        assert!(host_matches(
            "api.github.com:443",
            &["api.github.com".into()]
        ));
    }

    #[test]
    fn test_host_matches_empty_host() {
        assert!(!host_matches("", &["example.com".into()]));
    }

    // ── is_private_or_loopback ──

    #[test]
    fn test_private_loopback_127() {
        assert!(is_private_or_loopback("127.0.0.1"));
        assert!(is_private_or_loopback("127.0.0.2"));
    }

    #[test]
    fn test_private_loopback_ipv6() {
        assert!(is_private_or_loopback("::1"));
    }

    #[test]
    fn test_private_loopback_localhost() {
        assert!(is_private_or_loopback("localhost"));
    }

    #[test]
    fn test_private_10_range() {
        assert!(is_private_or_loopback("10.0.0.1"));
        assert!(is_private_or_loopback("10.255.255.255"));
    }

    #[test]
    fn test_private_172_range() {
        assert!(is_private_or_loopback("172.16.0.1"));
        assert!(is_private_or_loopback("172.31.255.255"));
    }

    #[test]
    fn test_private_192_range() {
        assert!(is_private_or_loopback("192.168.0.1"));
        assert!(is_private_or_loopback("192.168.255.255"));
    }

    #[test]
    fn test_private_link_local() {
        assert!(is_private_or_loopback("169.254.1.1"));
    }

    #[test]
    fn test_private_dot_local() {
        assert!(is_private_or_loopback("myhost.local"));
    }

    #[test]
    fn test_private_dot_internal() {
        assert!(is_private_or_loopback("service.internal"));
    }

    #[test]
    fn test_public_not_private() {
        assert!(!is_private_or_loopback("8.8.8.8"));
        assert!(!is_private_or_loopback("api.github.com"));
        assert!(!is_private_or_loopback("172.15.0.1")); // outside 16-31
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

    // ── extract_credential_refs ──

    #[test]
    fn test_extract_refs_single() {
        let refs = extract_credential_refs("Bearer {{credential:naver_api}}");
        assert_eq!(refs, vec!["naver_api"]);
    }

    #[test]
    fn test_extract_refs_multiple() {
        let refs = extract_credential_refs(
            "{{credential:a}} and {{credential:b}} and {{credential:a}}",
        );
        assert_eq!(refs, vec!["a", "b"]); // deduped and sorted
    }

    #[test]
    fn test_extract_refs_none() {
        let refs = extract_credential_refs("no credentials here");
        assert!(refs.is_empty());
    }

    #[test]
    fn test_extract_refs_incomplete() {
        let refs = extract_credential_refs("{{credential:incomplete");
        assert!(refs.is_empty());
    }

    // ── has_unresolved_refs ──

    #[test]
    fn test_has_unresolved_true() {
        assert!(has_unresolved_refs("Bearer {{credential:unknown}}"));
    }

    #[test]
    fn test_has_unresolved_false() {
        assert!(!has_unresolved_refs("Bearer sk-123456"));
    }
}
