use crate::db::{agent_operations, operations, Database};
use crate::services::credential_service;
use std::collections::HashSet;
use tauri::AppHandle;
use tokio::time::Duration;

use super::config::get_agents_dir_for_tools;

const MAX_RESPONSE_BYTES: usize = 512 * 1024; // 512KB

/// Get the set of credential IDs this agent is allowed to use.
fn get_agent_allowed_credentials(
    app: &AppHandle,
    db: &Database,
    conversation_id: &str,
) -> Result<HashSet<String>, String> {
    let conv = operations::get_conversation_detail_impl(db, conversation_id.to_string())
        .map_err(|e| format!("Failed to get conversation: {}", e))?;

    let agent = agent_operations::get_agent_impl(db, conv.agent_id)
        .map_err(|e| format!("Failed to get agent: {}", e))?;

    let agents_dir = get_agents_dir_for_tools(app)?;
    let config_path = agents_dir
        .join(&agent.folder_name)
        .join("TOOL_CONFIG.json");

    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(_) => return Ok(HashSet::new()), // no config → no credentials
    };

    let config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Invalid TOOL_CONFIG.json: {}", e))?;

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
    Ok(allowed)
}

/// Validate URL for http_request: scheme, host, private/loopback, credential host matching.
fn validate_http_request_url(
    parsed: &url::Url,
    has_credentials: bool,
    credential_ids: &[String],
    app: &AppHandle,
) -> Result<(), String> {
    let host = parsed.host_str().unwrap_or("");

    // Private/loopback hard deny (no override)
    if credential_service::is_private_or_loopback(host) {
        return Err(format!(
            "http_request: private/loopback address '{}' is not allowed",
            host
        ));
    }

    if has_credentials {
        // Credentialed requests require HTTPS
        if parsed.scheme() != "https" {
            return Err("http_request: credentialed requests require HTTPS".into());
        }

        // Validate host against each credential's allowed_hosts
        for cred_id in credential_ids {
            let meta = credential_service::get_credential_meta(app, cred_id)?;
            if !credential_service::host_matches(host, &meta.allowed_hosts) {
                return Err(format!(
                    "URL host '{}' not in allowed_hosts for credential '{}'",
                    host, cred_id
                ));
            }
        }
    }

    Ok(())
}

/// Substitute `{{credential:ID}}` placeholders in a string with resolved values.
fn substitute_credentials(text: &str, secrets: &[(String, String)]) -> String {
    let mut result = text.to_string();
    for (id, value) in secrets {
        result = result.replace(&format!("{{{{credential:{}}}}}", id), value);
    }
    result
}

/// Read the response body with a size limit, returning (body_text, status, content_type, truncated).
async fn read_response_body(
    resp: reqwest::Response,
    max_bytes: usize,
) -> Result<(String, u16, String, bool), String> {
    let status = resp.status().as_u16();
    let content_type = resp
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    // Check content type — only text-based content
    let is_text = content_type.is_empty()
        || content_type.starts_with("text/")
        || content_type.contains("application/json")
        || content_type.contains("application/xml")
        || content_type.contains("application/xhtml")
        || content_type.contains("+json")
        || content_type.contains("+xml");

    if !is_text {
        return Ok((
            format!("[Binary content: {}]", content_type),
            status,
            content_type,
            false,
        ));
    }

    // Stream body with size cap
    use futures::StreamExt;
    let mut stream = resp.bytes_stream();
    let mut body = Vec::with_capacity(max_bytes.min(65536));
    let mut truncated = false;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result
            .map_err(|e: reqwest::Error| format!("Failed to read response: {}", e))?;
        let remaining = max_bytes.saturating_sub(body.len());
        if remaining == 0 {
            truncated = true;
            break;
        }
        let take = chunk.len().min(remaining);
        body.extend_from_slice(&chunk[..take]);
        if take < chunk.len() {
            truncated = true;
            break;
        }
    }

    let body_str = String::from_utf8_lossy(&body).to_string();
    Ok((body_str, status, content_type, truncated))
}

/// Execute an HTTP request with credential injection and redirect handling.
pub(crate) async fn tool_http_request(
    app: &AppHandle,
    input: &serde_json::Value,
    conversation_id: &str,
    db: &Database,
) -> Result<serde_json::Value, String> {
    // 1. Parse parameters
    let method = input["method"]
        .as_str()
        .unwrap_or("GET")
        .to_uppercase();
    let url_str = input["url"]
        .as_str()
        .ok_or("http_request: missing 'url' parameter")?;
    let headers_input = input["headers"].as_object();
    let body_input = input["body"].as_str();
    let timeout_secs = input["timeout_secs"]
        .as_u64()
        .unwrap_or(30)
        .min(120);

    if !["GET", "POST", "PUT", "DELETE", "PATCH"].contains(&method.as_str()) {
        return Err(format!("http_request: unsupported method '{}'", method));
    }

    // 2. Extract {{credential:ID}} from headers and body ONLY (not URL)
    let mut all_refs: Vec<String> = Vec::new();
    if let Some(hdrs) = headers_input {
        for (_, v) in hdrs {
            if let Some(s) = v.as_str() {
                all_refs.extend(credential_service::extract_credential_refs(s));
            }
        }
    }
    if let Some(body) = body_input {
        all_refs.extend(credential_service::extract_credential_refs(body));
    }
    all_refs.sort();
    all_refs.dedup();
    let has_credentials = !all_refs.is_empty();

    // 3. Resolve credentials: check agent access, get values
    let mut secrets: Vec<(String, String)> = Vec::new();
    if has_credentials {
        let allowed_creds = get_agent_allowed_credentials(app, db, conversation_id)?;
        for id in &all_refs {
            if !allowed_creds.contains(id) {
                return Err(format!(
                    "http_request: agent does not have access to credential '{}'",
                    id
                ));
            }
            let value = credential_service::get_secret(app, id)?;
            secrets.push((id.clone(), value));
        }
    }

    // 4. Validate initial URL
    let parsed_url = url::Url::parse(url_str)
        .map_err(|e| format!("http_request: invalid URL '{}': {}", url_str, e))?;
    validate_http_request_url(&parsed_url, has_credentials, &all_refs, app)?;

    // 5. Substitute credentials in headers and body, track which headers carry secrets
    let mut final_headers: Vec<(String, String)> = Vec::new();
    let mut credential_header_keys: Vec<String> = Vec::new();
    if let Some(hdrs) = headers_input {
        for (k, v) in hdrs {
            if let Some(s) = v.as_str() {
                let substituted = substitute_credentials(s, &secrets);
                if substituted != s {
                    credential_header_keys.push(k.to_lowercase());
                }
                final_headers.push((k.clone(), substituted));
            }
        }
    }
    let final_body = body_input.map(|b| substitute_credentials(b, &secrets));

    // 6. Fail closed: check for unresolved credential references
    for (_, v) in &final_headers {
        if credential_service::has_unresolved_refs(v) {
            return Err("http_request: unresolved credential reference in headers".into());
        }
    }
    if let Some(ref b) = final_body {
        if credential_service::has_unresolved_refs(b) {
            return Err("http_request: unresolved credential reference in body".into());
        }
    }

    // 7. Build HTTP client — always disable auto-redirects to enforce
    // private/loopback deny on every hop (even non-credentialed requests)
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("http_request: client error: {}", e))?;

    // 8. Execute with manual redirect handling for credentialed requests
    let mut current_url = parsed_url;
    let mut current_method = method;
    let mut current_body = final_body;
    let mut current_headers = final_headers;
    let max_redirects: u32 = 3; // manual redirect handling for all requests

    for hop in 0..max_redirects + 1 {
        let mut req = match current_method.as_str() {
            "GET" => client.get(current_url.as_str()),
            "POST" => client.post(current_url.as_str()),
            "PUT" => client.put(current_url.as_str()),
            "DELETE" => client.delete(current_url.as_str()),
            "PATCH" => client.patch(current_url.as_str()),
            _ => unreachable!(),
        };

        req = req.header("User-Agent", "WindowAgent/1.0");
        for (k, v) in &current_headers {
            req = req.header(k, v);
        }
        if let Some(ref body) = current_body {
            req = req.body(body.clone());
        }

        let resp = req
            .send()
            .await
            .map_err(|e| format!("http_request: request failed: {}", e))?;

        let status = resp.status();

        // Handle redirects — manual for ALL requests to enforce private/loopback deny on every hop
        if status.is_redirection() {
            // Exhausted redirect budget — error out
            if hop >= max_redirects {
                return Err("http_request: too many redirects".into());
            }

            if let Some(location) = resp.headers().get("location") {
                let loc_str = location
                    .to_str()
                    .map_err(|_| "http_request: invalid Location header")?;

                // Resolve relative URLs against current URL
                let next_url = current_url
                    .join(loc_str)
                    .map_err(|e| format!("http_request: invalid redirect URL: {}", e))?;

                // Re-validate scheme + host + private for the redirect target
                validate_http_request_url(&next_url, has_credentials, &all_refs, app)?;

                let status_code = status.as_u16();
                match status_code {
                    307 | 308 => {
                        // Preserve method, body, headers
                    }
                    301..=303 => {
                        // Convert to GET, drop body
                        current_method = "GET".to_string();
                        current_body = None;
                        // For credentialed requests: strip ALL credential-bearing headers
                        if has_credentials {
                            current_headers.retain(|(k, _)| {
                                let kl = k.to_lowercase();
                                !kl.eq_ignore_ascii_case("authorization")
                                    && !credential_header_keys.contains(&kl)
                            });
                        }
                    }
                    _ => {
                        // Not a standard redirect — fall through to response processing
                    }
                }

                if matches!(status_code, 301 | 302 | 303 | 307 | 308) {
                    current_url = next_url;
                    continue;
                }
            }
        }

        // 9. Process response
        let (mut body_text, resp_status, content_type, truncated) =
            read_response_body(resp, MAX_RESPONSE_BYTES).await?;

        if truncated {
            body_text = format!(
                "{}... [truncated at {} bytes]",
                body_text, MAX_RESPONSE_BYTES
            );
        }

        // 10. Redact response before returning (before DB persistence)
        if has_credentials {
            body_text = credential_service::redact_output(&body_text, &secrets);
        }

        return Ok(serde_json::json!({
            "status": resp_status,
            "content_type": content_type,
            "body": body_text,
        }));
    }

    Err("http_request: too many redirects".into())
}
