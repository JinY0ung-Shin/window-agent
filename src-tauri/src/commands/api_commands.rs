use crate::api::*;
use tauri::State;

#[tauri::command]
pub fn has_api_key(api: State<'_, ApiState>) -> bool {
    api.has_api_key()
}

#[tauri::command]
pub fn set_api_config(
    app: tauri::AppHandle,
    api: State<'_, ApiState>,
    request: SetApiConfigRequest,
) -> Result<(), String> {
    api.set_config(request.api_key, request.base_url, &app)
}

#[tauri::command]
pub async fn chat_completion(
    api: State<'_, ApiState>,
    request: ChatCompletionRequest,
) -> Result<ChatCompletionResponse, String> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if api_key.is_empty() {
        return Err("API key not configured".into());
    }

    // Build messages array: system prompt + user messages
    let mut api_messages = Vec::new();
    api_messages.push(serde_json::json!({
        "role": "system",
        "content": request.system_prompt,
    }));
    for msg in &request.messages {
        api_messages.push(serde_json::json!({
            "role": msg.role,
            "content": msg.content,
        }));
    }

    // Build request body
    let mut body = serde_json::json!({
        "model": request.model,
        "messages": api_messages,
    });

    if let Some(temp) = request.temperature {
        body["temperature"] = serde_json::json!(temp);
    }

    // Try with thinking first if enabled
    if request.thinking_enabled {
        if let Some(budget) = request.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }

        match do_completion(&client, &api_key, &base_url, &body).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                // Only retry without thinking for thinking-specific failures
                // (HTTP 400/422 with thinking-related error text).
                // For auth, rate-limit, server, or network errors, propagate directly.
                if is_thinking_specific_error(&e) {
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("thinking");
                    }
                    // Fall through to retry without thinking below
                } else {
                    return Err(e);
                }
            }
        }
    }

    do_completion(&client, &api_key, &base_url, &body)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn bootstrap_completion(
    api: State<'_, ApiState>,
    request: BootstrapCompletionRequest,
) -> Result<BootstrapCompletionResponse, String> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if api_key.is_empty() {
        return Err("API key not configured".into());
    }

    let body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "tools": request.tools,
    });

    let url = completions_url(&base_url);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP_{}: {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: JSON parse error: {}", e))?;

    let message = json["choices"][0]["message"].clone();

    Ok(BootstrapCompletionResponse { message })
}

#[tauri::command]
pub async fn list_models(api: State<'_, ApiState>) -> Result<Vec<String>, String> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if api_key.is_empty() {
        return Err("API key not configured".into());
    }

    let url = models_url(&base_url);

    let resp = client
        .get(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP_{}: {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: JSON parse error: {}", e))?;

    let mut models: Vec<String> = json["data"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m["id"].as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    models.sort();
    Ok(models)
}

// ── Internal helpers ──

/// Build the models endpoint URL from base_url.
fn models_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    // Strip /chat/completions suffix if present to get the base
    let base = trimmed
        .strip_suffix("/chat/completions")
        .unwrap_or(trimmed);
    format!("{}/models", base.trim_end_matches('/'))
}

/// Build the completions endpoint URL.
/// If base_url already contains "/chat/completions", use it as-is.
/// Otherwise append "/chat/completions" to the base URL.
fn completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

/// Check whether an error string from `do_completion` indicates a thinking-specific
/// failure (HTTP 400 or 422 with thinking/unsupported related text), as opposed to
/// auth, rate-limit, server, or network errors that should not trigger a retry.
fn is_thinking_specific_error(err: &str) -> bool {
    // Must be an HTTP error with status 400 or 422
    let is_relevant_status = err.starts_with("HTTP_400:") || err.starts_with("HTTP_422:");
    if !is_relevant_status {
        return false;
    }

    let lower = err.to_lowercase();
    lower.contains("thinking")
        || lower.contains("not supported")
        || lower.contains("not_supported")
        || lower.contains("unsupported")
        || lower.contains("budget_tokens")
}

async fn do_completion(
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    body: &serde_json::Value,
) -> Result<ChatCompletionResponse, String> {
    let url = completions_url(base_url);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP_{}: {}", status, text));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: JSON parse error: {}", e))?;

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let reasoning_content = json["choices"][0]["message"]["reasoning_content"]
        .as_str()
        .map(|s| s.to_string());

    // Reject empty responses – the API returned no useful content
    if content.is_empty() && reasoning_content.is_none() {
        return Err("EMPTY_RESPONSE: No content in API response".to_string());
    }

    Ok(ChatCompletionResponse {
        content,
        reasoning_content,
    })
}
