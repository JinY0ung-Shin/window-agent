use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::ai::backend::{AiBackend, AiError};
use crate::ai::types::{ApiConfig, ChatMessage};

pub struct OllamaClient {
    client: Client,
    config: ApiConfig,
}

#[derive(Debug, Serialize)]
struct OllamaRequest {
    model: String,
    messages: Vec<OllamaMessage>,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OllamaMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OllamaResponse {
    message: Option<OllamaResponseMessage>,
    done: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct OllamaResponseMessage {
    content: Option<String>,
}

impl OllamaClient {
    pub fn new(config: ApiConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    fn build_messages(&self, messages: Vec<ChatMessage>) -> Vec<OllamaMessage> {
        let mut result = Vec::new();

        if let Some(ref system) = self.config.system_prompt {
            result.push(OllamaMessage {
                role: "system".to_string(),
                content: system.clone(),
            });
        }

        for msg in messages {
            result.push(OllamaMessage {
                role: msg.role,
                content: msg.content,
            });
        }

        result
    }
}

#[async_trait]
impl AiBackend for OllamaClient {
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, AiError> {
        let request = OllamaRequest {
            model: self.config.model.clone(),
            messages: self.build_messages(messages),
            stream: false,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{}: {}", status, body)));
        }

        let api_response: OllamaResponse = response.json().await.map_err(|e| {
            AiError::Parse(format!("Failed to parse Ollama response: {}", e))
        })?;

        let text = api_response
            .message
            .and_then(|m| m.content)
            .unwrap_or_default();

        Ok(text)
    }

    async fn send_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        sender: mpsc::UnboundedSender<String>,
    ) -> Result<String, AiError> {
        let request = OllamaRequest {
            model: self.config.model.clone(),
            messages: self.build_messages(messages),
            stream: true,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("Content-Type", "application/json")
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

            // NDJSON: each line is a complete JSON object
            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Ok(resp) = serde_json::from_str::<OllamaResponse>(&line) {
                    if let Some(ref msg) = resp.message {
                        if let Some(ref content) = msg.content {
                            if !content.is_empty() {
                                full_response.push_str(content);
                                if sender.send(content.clone()).is_err() {
                                    return Err(AiError::Channel);
                                }
                            }
                        }
                    }
                    if resp.done == Some(true) {
                        break;
                    }
                }
            }
        }

        Ok(full_response)
    }
}
