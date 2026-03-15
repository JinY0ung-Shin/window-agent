use crate::api::*;
use crate::models::api_types::ModelsResponse;
use crate::services::api_service;
use tauri::{Emitter, State};

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
    for msg in request.messages {
        api_messages.push(msg);
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

        match api_service::do_completion(&client, &api_key, &base_url, &body).await {
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

    api_service::do_completion(&client, &api_key, &base_url, &body)
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

    let url = api_service::completions_url(&base_url);

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

    let url = api_service::models_url(&base_url);

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

    let parsed: ModelsResponse = resp
        .json()
        .await
        .map_err(|e| format!("PARSE_ERROR: JSON parse error: {}", e))?;

    let mut models: Vec<String> = parsed.data.into_iter().map(|m| m.id).collect();

    models.sort();
    Ok(models)
}

#[tauri::command]
pub async fn chat_completion_stream(
    app: tauri::AppHandle,
    api: State<'_, ApiState>,
    registry: State<'_, RunRegistry>,
    request: ChatCompletionRequest,
    request_id: String,
) -> Result<(), String> {
    let (api_key, base_url) = api.effective();
    let client = api.client();

    if api_key.is_empty() {
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
        return Err("API key not configured".into());
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
            match api_service::stream_completion(&app_clone, &client, &api_key, &base_url, &body, &rid).await {
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
                        if let Err(e2) =
                            api_service::stream_completion(&app_clone, &client, &api_key, &base_url, &body, &rid).await
                        {
                            let _ = app_clone.emit(
                                "chat-stream-done",
                                StreamDonePayload {
                                    request_id: rid.clone(),
                                    full_content: String::new(),
                                    reasoning_content: None,
                                    tool_calls: None,
                                    error: Some(e2),
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
                                error: Some(e),
                            },
                        );
                        reg.remove(&rid).await;
                        return;
                    }
                }
            }
        }

        // Non-thinking path
        if let Err(e) = api_service::stream_completion(&app_clone, &client, &api_key, &base_url, &body, &rid).await {
            let _ = app_clone.emit(
                "chat-stream-done",
                StreamDonePayload {
                    request_id: rid.clone(),
                    full_content: String::new(),
                    reasoning_content: None,
                    tool_calls: None,
                    error: Some(e),
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
) -> Result<bool, String> {
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
