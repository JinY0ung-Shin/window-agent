use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::ai::types::ChatMessage;

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("API error: {0}")]
    Api(String),
    #[error("Stream parse error: {0}")]
    Parse(String),
    #[error("Channel send error")]
    Channel,
    #[error("Backend not configured: {0}")]
    NotConfigured(String),
}

#[async_trait]
pub trait AiBackend: Send + Sync {
    async fn send_message(&self, messages: Vec<ChatMessage>) -> Result<String, AiError>;
    async fn send_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        sender: mpsc::UnboundedSender<String>,
    ) -> Result<String, AiError>;
}
