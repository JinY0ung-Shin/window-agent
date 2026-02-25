use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use tokio::sync::mpsc;

use crate::ai::backend::{AiBackend, AiError};
use crate::ai::types::*;

const API_VERSION: &str = "2023-06-01";

pub struct ClaudeClient {
    client: Client,
    config: ApiConfig,
}

impl ClaudeClient {
    pub fn new(config: ApiConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }
}

#[async_trait]
impl AiBackend for ClaudeClient {
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, AiError> {
        let request = ApiRequest {
            model: self.config.model.clone(),
            max_tokens: self.config.max_tokens,
            system: self.config.system_prompt.clone(),
            messages,
            stream: false,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{}: {}", status, body)));
        }

        let api_response: ApiResponse = response.json().await?;
        let text = api_response
            .content
            .iter()
            .filter_map(|block| block.text.as_deref())
            .collect::<Vec<_>>()
            .join("");

        Ok(text)
    }

    async fn send_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        sender: mpsc::UnboundedSender<String>,
    ) -> Result<String, AiError> {
        let request = ApiRequest {
            model: self.config.model.clone(),
            max_tokens: self.config.max_tokens,
            system: self.config.system_prompt.clone(),
            messages,
            stream: true,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("x-api-key", &self.config.api_key)
            .header("anthropic-version", API_VERSION)
            .header("content-type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{}: {}", status, body)));
        }

        let mut full_response = String::new();
        let mut stream = response.bytes_stream();
        let mut buffer = String::new();

        while let Some(chunk_result) = stream.next().await {
            let chunk = chunk_result?;
            let chunk_str = String::from_utf8_lossy(&chunk);
            buffer.push_str(&chunk_str);

            while let Some(pos) = buffer.find("\n\n") {
                let event_block = buffer[..pos].to_string();
                buffer = buffer[pos + 2..].to_string();

                if let Some(text) = parse_sse_event(&event_block) {
                    full_response.push_str(&text);
                    if sender.send(text).is_err() {
                        return Err(AiError::Channel);
                    }
                }
            }
        }

        if !buffer.trim().is_empty() {
            if let Some(text) = parse_sse_event(&buffer) {
                full_response.push_str(&text);
                let _ = sender.send(text);
            }
        }

        Ok(full_response)
    }
}

/// Parse a single SSE event block and extract text if it's a content_block_delta
fn parse_sse_event(event_block: &str) -> Option<String> {
    let mut data_line = None;

    for line in event_block.lines() {
        if let Some(stripped) = line.strip_prefix("data: ") {
            data_line = Some(stripped);
        }
    }

    let data = data_line?;

    if data.trim() == "[DONE]" {
        return None;
    }

    let event: StreamEvent = serde_json::from_str(data).ok()?;

    match event {
        StreamEvent::ContentBlockDelta { delta, .. } => {
            if delta.delta_type == "text_delta" && !delta.text.is_empty() {
                Some(delta.text)
            } else {
                None
            }
        }
        StreamEvent::Error { error } => {
            eprintln!(
                "Claude API stream error: {} - {}",
                error.error_type, error.message
            );
            None
        }
        _ => None,
    }
}
