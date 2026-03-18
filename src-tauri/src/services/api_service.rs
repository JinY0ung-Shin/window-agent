use crate::api::*;
use crate::error::AppError;
use crate::models::api_types::{CompletionChunk, CompletionResponse};
use futures::StreamExt;
use serde::Serialize;
use tauri::Emitter;

// ── HTTP Debug Logging ──

#[derive(Debug, Clone, Serialize)]
pub struct HttpLogEntry {
    pub id: String,
    pub timestamp: String,
    pub method: String,
    pub url: String,
    pub status: Option<u16>,
    pub duration_ms: Option<u64>,
    pub request_headers: String,
    pub response_headers: String,
    pub response_body_preview: String,
    pub error: Option<String>,
}

/// Emit an HTTP log entry to the frontend via Tauri event.
pub fn emit_http_log_entry(app: &tauri::AppHandle, entry: HttpLogEntry) {
    let _ = app.emit("debug:http-log", entry);
}

/// Format response headers for display.
pub fn format_resp_headers(headers: &reqwest::header::HeaderMap) -> String {
    headers
        .iter()
        .map(|(k, v)| format!("{}: {}", k, v.to_str().unwrap_or("<binary>")))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Truncate text for preview.
pub fn truncate_text(s: &str, max: usize) -> String {
    if s.len() <= max { s.to_string() } else { format!("{}...", &s[..max]) }
}

// ── URL builders ──

/// Build the models endpoint URL from base_url.
pub fn models_url(base_url: &str) -> String {
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
pub fn completions_url(base_url: &str) -> String {
    let trimmed = base_url.trim_end_matches('/');
    if trimmed.ends_with("/chat/completions") {
        trimmed.to_string()
    } else {
        format!("{}/chat/completions", trimmed)
    }
}

// ── Thinking fallback ──

/// Check whether an AppError indicates a thinking-specific failure
/// (HTTP 400 or 422 with thinking/unsupported related text), as opposed to
/// auth, rate-limit, server, or network errors that should not trigger a retry.
pub fn is_thinking_specific_error(err: &AppError) -> bool {
    let msg = match err {
        AppError::Api(msg) => msg.as_str(),
        _ => return false,
    };

    // Must be an HTTP error with status 400 or 422
    let is_relevant_status = msg.starts_with("HTTP_400:") || msg.starts_with("HTTP_422:");
    if !is_relevant_status {
        return false;
    }

    let lower = msg.to_lowercase();
    lower.contains("thinking")
        || lower.contains("not supported")
        || lower.contains("not_supported")
        || lower.contains("unsupported")
        || lower.contains("budget_tokens")
}

// ── Non-streaming completion ──

/// Execute a non-streaming chat completion request.
pub async fn do_completion(
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    body: &serde_json::Value,
    app: Option<&tauri::AppHandle>,
) -> Result<ChatCompletionResponse, AppError> {
    let url = completions_url(base_url);
    let start = std::time::Instant::now();
    let log_id = uuid::Uuid::new_v4().to_string();

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json");
    let auth_header = if !api_key.is_empty() {
        let h = format!("Bearer {}...{}", &api_key[..4.min(api_key.len())], &api_key[api_key.len().saturating_sub(3)..]);
        req = req.header("Authorization", format!("Bearer {}", api_key));
        h
    } else {
        "(none)".to_string()
    };

    let resp = match req.json(body).send().await {
        Ok(r) => r,
        Err(e) => {
            if let Some(app) = app {
                emit_http_log_entry(app, HttpLogEntry {
                    id: log_id,
                    timestamp: chrono::Utc::now().to_rfc3339(),
                    method: "POST".into(),
                    url: url.clone(),
                    status: None,
                    duration_ms: Some(start.elapsed().as_millis() as u64),
                    request_headers: format!("Authorization: {auth_header}"),
                    response_headers: String::new(),
                    response_body_preview: String::new(),
                    error: Some(e.to_string()),
                });
            }
            return Err(e.into());
        }
    };

    let status = resp.status().as_u16();
    let resp_headers = format_resp_headers(resp.headers());

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        if let Some(app) = app {
            emit_http_log_entry(app, HttpLogEntry {
                id: log_id,
                timestamp: chrono::Utc::now().to_rfc3339(),
                method: "POST".into(),
                url: url.clone(),
                status: Some(status),
                duration_ms: Some(start.elapsed().as_millis() as u64),
                request_headers: format!("Authorization: {auth_header}"),
                response_headers: resp_headers,
                response_body_preview: truncate_text(&text, 500),
                error: Some(format!("HTTP {status}")),
            });
        }
        return Err(AppError::Api(format!("HTTP_{}: {}", status, text)));
    }

    let parsed: CompletionResponse = resp
        .json()
        .await
        .map_err(|e| AppError::Api(format!("PARSE_ERROR: JSON parse error: {}", e)))?;

    if let Some(app) = app {
        emit_http_log_entry(app, HttpLogEntry {
            id: log_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
            method: "POST".into(),
            url,
            status: Some(status),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            request_headers: format!("Authorization: {auth_header}"),
            response_headers: resp_headers,
            response_body_preview: format!("choices={}", parsed.choices.len()),
            error: None,
        });
    }

    let msg = parsed
        .choices
        .first()
        .and_then(|c| c.message.as_ref());

    let content = msg
        .and_then(|m| m.content.as_deref())
        .unwrap_or("")
        .to_string();

    let reasoning_content = msg
        .and_then(|m| m.reasoning_content.clone());

    // Reject empty responses – the API returned no useful content
    if content.is_empty() && reasoning_content.is_none() {
        return Err(AppError::Api("EMPTY_RESPONSE: No content in API response".to_string()));
    }

    Ok(ChatCompletionResponse {
        content,
        reasoning_content,
    })
}

// ── Streaming completion ──

/// Execute a streaming completion request, emitting SSE chunks via Tauri events.
pub async fn stream_completion(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    api_key: &str,
    base_url: &str,
    body: &serde_json::Value,
    request_id: &str,
) -> Result<(), AppError> {
    let url = completions_url(base_url);
    let start = std::time::Instant::now();
    let log_id = uuid::Uuid::new_v4().to_string();

    let auth_preview = if !api_key.is_empty() {
        format!("Bearer {}...{}", &api_key[..4.min(api_key.len())], &api_key[api_key.len().saturating_sub(3)..])
    } else {
        "(none)".to_string()
    };

    let mut req = client
        .post(&url)
        .header("Content-Type", "application/json");
    if !api_key.is_empty() {
        req = req.header("Authorization", format!("Bearer {}", api_key));
    }
    let resp = match req.json(body).send().await {
        Ok(r) => r,
        Err(e) => {
            emit_http_log_entry(app, HttpLogEntry {
                id: log_id,
                timestamp: chrono::Utc::now().to_rfc3339(),
                method: "POST".into(),
                url: url.clone(),
                status: None,
                duration_ms: Some(start.elapsed().as_millis() as u64),
                request_headers: format!("Authorization: {auth_preview}"),
                response_headers: String::new(),
                response_body_preview: String::new(),
                error: Some(e.to_string()),
            });
            return Err(e.into());
        }
    };

    let status_code = resp.status().as_u16();
    let resp_headers = format_resp_headers(resp.headers());

    // Check HTTP status before attempting to stream
    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        emit_http_log_entry(app, HttpLogEntry {
            id: log_id,
            timestamp: chrono::Utc::now().to_rfc3339(),
            method: "POST".into(),
            url: url.clone(),
            status: Some(status_code),
            duration_ms: Some(start.elapsed().as_millis() as u64),
            request_headers: format!("Authorization: {auth_preview}"),
            response_headers: resp_headers,
            response_body_preview: truncate_text(&text, 500),
            error: Some(format!("HTTP {status_code}")),
        });
        return Err(AppError::Api(format!("HTTP_{}: {}", status_code, text)));
    }

    // Log successful stream start
    emit_http_log_entry(app, HttpLogEntry {
        id: log_id,
        timestamp: chrono::Utc::now().to_rfc3339(),
        method: "POST (stream)".into(),
        url,
        status: Some(status_code),
        duration_ms: Some(start.elapsed().as_millis() as u64),
        request_headers: format!("Authorization: {auth_preview}"),
        response_headers: resp_headers,
        response_body_preview: "SSE stream started".into(),
        error: None,
    });

    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    let mut full_content = String::new();
    let mut full_reasoning = String::new();
    // Accumulator for tool calls across streaming chunks
    let mut tool_calls_acc: Vec<ToolCall> = Vec::new();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| AppError::Api(format!("Stream error: {}", e)))?;
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

                if let Ok(chunk) = serde_json::from_str::<CompletionChunk>(data) {
                    let delta = chunk.choices.first().and_then(|c| c.delta.as_ref());

                    let delta_content = delta
                        .and_then(|d| d.content.as_deref())
                        .unwrap_or("")
                        .to_string();
                    let delta_reasoning = delta
                        .and_then(|d| d.reasoning_content.clone());

                    // Extract tool_calls deltas from the parsed chunk
                    let tool_calls_deltas: Option<Vec<ToolCallDelta>> = delta
                        .and_then(|d| d.tool_calls.clone());

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
