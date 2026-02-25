use async_trait::async_trait;
use futures::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;

use crate::ai::backend::{AiBackend, AiError};
use crate::ai::types::{ApiConfig, ChatMessage};

pub struct OpenAiClient {
    client: Client,
    config: ApiConfig,
}

#[derive(Debug, Serialize)]
struct OpenAiRequest {
    model: String,
    messages: Vec<OpenAiMessage>,
    max_tokens: u32,
    stream: bool,
}

#[derive(Debug, Serialize)]
struct OpenAiMessage {
    role: String,
    content: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    choices: Vec<OpenAiChoice>,
}

#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    message: Option<OpenAiMessageContent>,
    delta: Option<OpenAiDelta>,
}

#[derive(Debug, Deserialize)]
struct OpenAiMessageContent {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct OpenAiDelta {
    content: Option<String>,
}

impl OpenAiClient {
    pub fn new(config: ApiConfig) -> Self {
        Self {
            client: Client::new(),
            config,
        }
    }

    fn build_messages(&self, messages: Vec<ChatMessage>) -> Vec<OpenAiMessage> {
        let mut result = Vec::new();

        if let Some(ref system) = self.config.system_prompt {
            result.push(OpenAiMessage {
                role: "system".to_string(),
                content: system.clone(),
            });
        }

        for msg in messages {
            result.push(OpenAiMessage {
                role: msg.role,
                content: msg.content,
            });
        }

        result
    }
}

#[async_trait]
impl AiBackend for OpenAiClient {
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, AiError> {
        let request = OpenAiRequest {
            model: self.config.model.clone(),
            messages: self.build_messages(messages),
            max_tokens: self.config.max_tokens,
            stream: false,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
            .header("Content-Type", "application/json")
            .json(&request)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            return Err(AiError::Api(format!("{}: {}", status, body)));
        }

        let api_response: OpenAiResponse = response.json().await.map_err(|e| {
            AiError::Parse(format!("Failed to parse OpenAI response: {}", e))
        })?;

        let text = api_response
            .choices
            .first()
            .and_then(|c| c.message.as_ref())
            .and_then(|m| m.content.clone())
            .unwrap_or_default();

        Ok(text)
    }

    async fn send_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        sender: mpsc::UnboundedSender<String>,
    ) -> Result<String, AiError> {
        let request = OpenAiRequest {
            model: self.config.model.clone(),
            messages: self.build_messages(messages),
            max_tokens: self.config.max_tokens,
            stream: true,
        };

        let response = self
            .client
            .post(&self.config.api_url)
            .header("Authorization", format!("Bearer {}", self.config.api_key))
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

            while let Some(pos) = buffer.find('\n') {
                let line = buffer[..pos].trim().to_string();
                buffer = buffer[pos + 1..].to_string();

                if line.is_empty() {
                    continue;
                }

                if let Some(data) = line.strip_prefix("data: ") {
                    if data.trim() == "[DONE]" {
                        continue;
                    }

                    if let Ok(chunk_resp) = serde_json::from_str::<OpenAiResponse>(data) {
                        if let Some(choice) = chunk_resp.choices.first() {
                            if let Some(ref delta) = choice.delta {
                                if let Some(ref content) = delta.content {
                                    if !content.is_empty() {
                                        full_response.push_str(content);
                                        if sender.send(content.clone()).is_err() {
                                            return Err(AiError::Channel);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(full_response)
    }
}
