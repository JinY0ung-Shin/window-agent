use crate::api::*;
use crate::error::AppError;
use crate::models::api_types::ModelsResponse;
use crate::services::{api_service, credential_service};
use tauri::{Emitter, State};

/// Returns true if API access is configured (key set OR custom URL).
#[tauri::command]
pub fn has_api_key(api: State<'_, ApiState>) -> bool {
    api.has_api_access()
}

/// Returns true only if an actual API key string is stored.
#[tauri::command]
pub fn has_stored_key(api: State<'_, ApiState>) -> bool {
    api.has_stored_key()
}

#[tauri::command]
pub fn set_api_config(
    app: tauri::AppHandle,
    api: State<'_, ApiState>,
    request: SetApiConfigRequest,
) -> Result<(), AppError> {
    api.set_config(request.api_key, request.base_url, &app)
        .map_err(AppError::Io)
}

#[tauri::command]
pub async fn chat_completion(
    app: tauri::AppHandle,
    api: State<'_, ApiState>,
    request: ChatCompletionRequest,
) -> Result<ChatCompletionResponse, AppError> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if crate::api::requires_api_key(&api_key, &base_url) {
        return Err(AppError::Validation("API key not configured".into()));
    }

    // Build messages array: system prompt + user messages
    let mut api_messages = Vec::new();
    api_messages.push(serde_json::json!({
        "role": "system",
        "content": request.system_prompt,
    }));
    for msg in request.messages {
        api_messages.push(msg);
    }

    // Defense-in-depth: scrub any credential values that may have leaked into messages
    if let Ok(credentials) = credential_service::get_all_secret_values(&app) {
        if !credentials.is_empty() {
            credential_service::scrub_messages(&mut api_messages, &credentials);
        }
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

        match api_service::do_completion(&client, &api_key, &base_url, &body, Some(&app)).await {
            Ok(resp) => return Ok(resp),
            Err(e) => {
                if api_service::is_thinking_specific_error(&e) {
                    if let Some(obj) = body.as_object_mut() {
                        obj.remove("thinking");
                    }
                } else {
                    return Err(e);
                }
            }
        }
    }

    api_service::do_completion(&client, &api_key, &base_url, &body, Some(&app)).await
}

#[tauri::command]
pub async fn bootstrap_completion(
    api: State<'_, ApiState>,
    request: BootstrapCompletionRequest,
) -> Result<BootstrapCompletionResponse, AppError> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if crate::api::requires_api_key(&api_key, &base_url) {
        return Err(AppError::Validation("API key not configured".into()));
    }

    let body = serde_json::json!({
        "model": request.model,
        "messages": request.messages,
        "tools": request.tools,
    });

    let url = api_service::completions_url(&base_url);

    let mut req = client.post(&url).header("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let resp = req.json(&body).send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("HTTP_{}: {}", status, text)));
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| AppError::Api(format!("PARSE_ERROR: JSON parse error: {}", e)))?;

    let message = json["choices"][0]["message"].clone();

    Ok(BootstrapCompletionResponse { message })
}

#[tauri::command]
pub async fn list_models(api: State<'_, ApiState>) -> Result<Vec<String>, AppError> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    // Allow keyless access for local/proxy servers (LiteLLM, vLLM etc.)
    if crate::api::requires_api_key(&api_key, &base_url) {
        return Err(AppError::Validation("API key not configured".into()));
    }

    let url = api_service::models_url(&base_url);

    let mut req = client.get(&url);
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let resp = req.send().await?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(AppError::Api(format!("HTTP_{}: {}", status, text)));
    }

    let parsed: ModelsResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Api(format!("PARSE_ERROR: JSON parse error: {}", e)))?;

    let mut models: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();

    models.sort();
    Ok(models)
}

fn format_http_detail(status: u16, text: String) -> String {
    let detail = text.trim();
    if detail.is_empty() {
        format!("HTTP {status}")
    } else {
        format!(
            "HTTP {status}: {}",
            detail.chars().take(300).collect::<String>()
        )
    }
}

#[tauri::command]
pub async fn check_api_health(
    api: State<'_, ApiState>,
    request: ApiHealthCheckRequest,
) -> Result<ApiHealthCheckResponse, AppError> {
    let (stored_api_key, stored_base_url) = api.effective();
    let client = api.client();

    let api_key = request.api_key.map(|k| k.trim().to_string()).unwrap_or(stored_api_key);
    let base_url = match request.base_url {
        Some(url) if url.trim().is_empty() => crate::api::DEFAULT_BASE_URL.to_string(),
        Some(url) => url.trim().to_string(),
        None => stored_base_url,
    };

    if crate::api::requires_api_key(&api_key, &base_url) {
        return Err(AppError::Validation("API key not configured".into()));
    }

    let models_url = api_service::models_url(&base_url);

    let (ok, detail) = {
        let mut req = client.get(&models_url);
        if !api_key.is_empty() {
            req = req.header("Authorization", format!("Bearer {}", api_key));
        }

        match req.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                // Capture server header for debugging
                let server_header = resp
                    .headers()
                    .get("server")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                if resp.status().is_success() {
                    match resp.json::<ModelsResponse>().await {
                        Ok(parsed) => {
                            let count = parsed.data.len();
                            let sample = parsed
                                .data
                                .iter()
                                .take(3)
                                .map(|m| m.id.clone())
                                .collect::<Vec<_>>()
                                .join(", ");
                            let detail = if sample.is_empty() {
                                format!("연결 성공 — 모델 {count}개")
                            } else {
                                format!("연결 성공 — 모델 {count}개 (예: {sample})")
                            };
                            (true, detail)
                        }
                        Err(e) => (false, format!("응답 파싱 실패: {e}")),
                    }
                } else {
                    let text = resp.text().await.unwrap_or_default();
                    let mut detail = format_http_detail(status, text);
                    if !server_header.is_empty() {
                        detail.push_str(&format!(" [서버: {server_header}]"));
                    }
                    detail.push_str(&format!(" [URL: {models_url}]"));
                    (false, detail)
                }
            }
            Err(e) => (false, format!("요청 실패: {e} [URL: {models_url}]")),
        }
    };

    let api_key_preview = if api_key.len() > 8 {
        format!("{}...{}", &api_key[..4], &api_key[api_key.len()-3..])
    } else if api_key.is_empty() {
        "(없음)".to_string()
    } else {
        format!("{}...", &api_key[..api_key.len().min(4)])
    };

    Ok(ApiHealthCheckResponse {
        ok,
        base_url,
        authorization_header_sent: !api_key.is_empty(),
        api_key_preview,
        detail,
    })
}

#[tauri::command]
pub async fn chat_completion_stream(
    app: tauri::AppHandle,
    api: State<'_, ApiState>,
    registry: State<'_, RunRegistry>,
    request: ChatCompletionRequest,
    request_id: String,
) -> Result<(), AppError> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if crate::api::requires_api_key(&api_key, &base_url) {
        let _ = app.emit(
            "chat-stream-done",
            StreamDonePayload {
                request_id,
                full_content: String::new(),
                reasoning_content: None,
                tool_calls: None,
                error: Some("API key not configured".into()),
            },
        );
        return Err(AppError::Validation("API key not configured".into()));
    }

    // Build messages array — messages are already JSON values from frontend
    let mut api_messages = Vec::new();
    api_messages.push(serde_json::json!({
        "role": "system",
        "content": request.system_prompt,
    }));
    for msg in request.messages {
        api_messages.push(msg);
    }

    // Defense-in-depth: scrub any credential values that may have leaked into messages
    if let Ok(credentials) = credential_service::get_all_secret_values(&app) {
        if !credentials.is_empty() {
            credential_service::scrub_messages(&mut api_messages, &credentials);
        }
    }

    let mut body = serde_json::json!({
        "model": request.model,
        "messages": api_messages,
        "stream": true,
    });

    if let Some(temp) = request.temperature {
        body["temperature"] = serde_json::json!(temp);
    }

    // Include tools in request if provided and non-empty
    if let Some(ref tools) = request.tools {
        if !tools.is_empty() {
            body["tools"] = serde_json::json!(tools);
        }
    }

    let thinking_enabled = request.thinking_enabled;
    if thinking_enabled {
        if let Some(budget) = request.thinking_budget {
            body["thinking"] = serde_json::json!({
                "type": "enabled",
                "budget_tokens": budget,
            });
        }
    }

    let app_clone = app.clone();
    let rid = request_id.clone();
    let reg: RunRegistry = (*registry).clone();

    let task = tokio::spawn(async move {
        // Thinking-enabled path with fallback
        if thinking_enabled {
            match api_service::stream_completion(
                &app_clone, &client, &api_key, &base_url, &body, &rid,
            )
            .await
            {
                Ok(()) => {
                    reg.remove(&rid).await;
                    return;
                }
                Err(e) => {
                    if api_service::is_thinking_specific_error(&e) {
                        // Remove thinking and fall through to retry
                        let mut body = body.clone();
                        if let Some(obj) = body.as_object_mut() {
                            obj.remove("thinking");
                        }
                        if let Err(e2) = api_service::stream_completion(
                            &app_clone, &client, &api_key, &base_url, &body, &rid,
                        )
                        .await
                        {
                            let _ = app_clone.emit(
                                "chat-stream-done",
                                StreamDonePayload {
                                    request_id: rid.clone(),
                                    full_content: String::new(),
                                    reasoning_content: None,
                                    tool_calls: None,
                                    error: Some(e2.to_string()),
                                },
                            );
                        }
                        reg.remove(&rid).await;
                        return;
                    } else {
                        let _ = app_clone.emit(
                            "chat-stream-done",
                            StreamDonePayload {
                                request_id: rid.clone(),
                                full_content: String::new(),
                                reasoning_content: None,
                                tool_calls: None,
                                error: Some(e.to_string()),
                            },
                        );
                        reg.remove(&rid).await;
                        return;
                    }
                }
            }
        }

        // Non-thinking path
        if let Err(e) =
            api_service::stream_completion(&app_clone, &client, &api_key, &base_url, &body, &rid)
                .await
        {
            let _ = app_clone.emit(
                "chat-stream-done",
                StreamDonePayload {
                    request_id: rid.clone(),
                    full_content: String::new(),
                    reasoning_content: None,
                    tool_calls: None,
                    error: Some(e.to_string()),
                },
            );
        }
        reg.remove(&rid).await;
    });

    registry.register(request_id, task.abort_handle()).await;
    Ok(())
}

#[tauri::command]
pub async fn abort_stream(
    app: tauri::AppHandle,
    registry: State<'_, RunRegistry>,
    request_id: String,
) -> Result<bool, AppError> {
    let aborted = registry.abort(&request_id).await;
    if aborted {
        let _ = app.emit(
            "chat-stream-done",
            StreamDonePayload {
                request_id,
                full_content: String::new(),
                reasoning_content: None,
                tool_calls: None,
                error: Some("aborted".to_string()),
            },
        );
    }
    Ok(aborted)
}
