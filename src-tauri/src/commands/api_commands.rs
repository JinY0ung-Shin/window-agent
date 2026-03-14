use crate::api::*;
use futures::StreamExt;
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
            match do_stream(&app_clone, &client, &api_key, &base_url, &body, &rid).await {
                Ok(()) => {
                    reg.remove(&rid).await;
                    return;
                }
                Err(e) => {
                    if is_thinking_specific_error(&e) {
                        // Remove thinking and fall through to retry
                        let mut body = body.clone();
                        if let Some(obj) = body.as_object_mut() {
                            obj.remove("thinking");
                        }
                        if let Err(e2) =
                            do_stream(&app_clone, &client, &api_key, &base_url, &body, &rid).await
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
        if let Err(e) = do_stream(&app_clone, &client, &api_key, &base_url, &body, &rid).await {
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

/// Execute a streaming completion request, emitting SSE chunks via Tauri events.
async fn do_stream(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    body: &serde_json::Value,
    request_id: &str,
) -> Result<(), String> {
    let url = completions_url(base_url);

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(body)
        .send()
        .await
        .map_err(|e| format!("HTTP error: {}", e))?;

    // Check HTTP status before attempting to stream
    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP_{}: {}", status, text));
    }

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    // Accumulator for tool calls across streaming chunks
    let mut tool_calls_acc: Vec<ToolCall> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Stream error: {}", e))?;
        buffer.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();

            if line.is_empty() || line.starts_with(':') {
                continue;
            }

            if let Some(data) = line.strip_prefix("data: ") {
                if data.trim() == "[DONE]" {
                    let final_tool_calls = if tool_calls_acc.is_empty() {
                        None
                    } else {
                        Some(tool_calls_acc)
                    };
                    let _ = app.emit(
                        "chat-stream-done",
                        StreamDonePayload {
                            request_id: request_id.to_string(),
                            full_content,
                            reasoning_content: if full_reasoning.is_empty() {
                                None
                            } else {
                                Some(full_reasoning)
                            },
                            tool_calls: final_tool_calls,
                            error: None,
                        },
                    );
                    return Ok(());
                }

                if let Ok(json) = serde_json::from_str::<serde_json::Value>(data) {
                    let delta_content = json["choices"][0]["delta"]["content"]
                        .as_str()
                        .unwrap_or("")
                        .to_string();
                    let delta_reasoning = json["choices"][0]["delta"]["reasoning_content"]
                        .as_str()
                        .map(|s| s.to_string());

                    // Parse tool_calls deltas from the SSE chunk
                    let tool_calls_deltas: Option<Vec<ToolCallDelta>> =
                        json["choices"][0]["delta"]["tool_calls"]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| serde_json::from_value::<ToolCallDelta>(v.clone()).ok())
                                    .collect()
                            });

                    // Accumulate tool calls by index
                    if let Some(ref deltas) = tool_calls_deltas {
                        for delta in deltas {
                            let idx = delta.index;
                            // Grow the accumulator if needed
                            while tool_calls_acc.len() <= idx {
                                tool_calls_acc.push(ToolCall {
                                    id: String::new(),
                                    r#type: "function".to_string(),
                                    function: ToolCallFunction {
                                        name: String::new(),
                                        arguments: String::new(),
                                    },
                                });
                            }
                            if let Some(ref id) = delta.id {
                                tool_calls_acc[idx].id = id.clone();
                            }
                            if let Some(ref func) = delta.function {
                                if let Some(ref name) = func.name {
                                    tool_calls_acc[idx].function.name = name.clone();
                                }
                                if let Some(ref args) = func.arguments {
                                    tool_calls_acc[idx].function.arguments.push_str(args);
                                }
                            }
                        }
                    }

                    let has_content = !delta_content.is_empty() || delta_reasoning.is_some();
                    let has_tool_calls = tool_calls_deltas.is_some();

                    if has_content || has_tool_calls {
                        full_content.push_str(&delta_content);
                        if let Some(ref r) = delta_reasoning {
                            full_reasoning.push_str(r);
                        }
                        let _ = app.emit(
                            "chat-stream-chunk",
                            StreamChunkPayload {
                                request_id: request_id.to_string(),
                                delta: delta_content,
                                reasoning_delta: delta_reasoning,
                                tool_calls_delta: tool_calls_deltas,
                            },
                        );
                    }
                }
            }
        }
    }

    // Stream ended without [DONE] — emit done with what we have
    let final_tool_calls = if tool_calls_acc.is_empty() {
        None
    } else {
        Some(tool_calls_acc)
    };
    let _ = app.emit(
        "chat-stream-done",
        StreamDonePayload {
            request_id: request_id.to_string(),
            full_content,
            reasoning_content: if full_reasoning.is_empty() {
                None
            } else {
                Some(full_reasoning)
            },
            tool_calls: final_tool_calls,
            error: None,
        },
    );
    Ok(())
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
