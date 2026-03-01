use tokio::sync::mpsc;
use tauri::Emitter;

use crate::ai::backend::{AiBackend, AiError};
use crate::ai::factory::create_backend;
use crate::ai::types::{AiBackendType, ApiConfig, ChatMessage, ChatStreamPayload};
use crate::db::models::Agent;

pub struct AgentRunner {
    agent_id: String,
    backend: Box<dyn AiBackend>,
}

impl AgentRunner {
    /// Create a new AgentRunner from an Agent DB record.
    /// Falls back to environment variables for API credentials.
    pub fn from_agent(agent: &Agent) -> Result<Self, AiError> {
        let backend_type: AiBackendType = agent
            .ai_backend
            .parse()
            .unwrap_or(AiBackendType::OpenAI);

        // Determine API key: agent-specific or env fallback
        let api_key = if agent.api_key.is_empty() {
            match backend_type {
                AiBackendType::Claude => {
                    std::env::var("ANTHROPIC_API_KEY").unwrap_or_default()
                }
                AiBackendType::OpenAI | AiBackendType::Custom => {
                    std::env::var("OPENAI_API_KEY").unwrap_or_default()
                }
                AiBackendType::Ollama => String::new(), // Ollama doesn't need API key
            }
        } else {
            agent.api_key.clone()
        };

        // Determine API URL: agent-specific or env fallback
        let api_url = if agent.api_url.is_empty() {
            match backend_type {
                AiBackendType::Claude => {
                    std::env::var("ANTHROPIC_API_URL")
                        .unwrap_or_else(|_| "https://api.anthropic.com/v1/messages".to_string())
                }
                AiBackendType::OpenAI | AiBackendType::Custom => {
                    std::env::var("OPENAI_API_URL")
                        .unwrap_or_else(|_| "https://api.openai.com/v1/chat/completions".to_string())
                }
                AiBackendType::Ollama => {
                    std::env::var("OLLAMA_API_URL")
                        .unwrap_or_else(|_| "http://localhost:11434/api/chat".to_string())
                }
            }
        } else {
            agent.api_url.clone()
        };

        // Environment variable takes priority over DB model
        let model = if agent.model.is_empty() {
            "gpt-5.3-codex".to_string()
        } else {
            agent.model.clone()
        };

        let config = ApiConfig {
            api_key,
            api_url,
            model,
            max_tokens: 4096,
            system_prompt: if agent.system_prompt.is_empty() {
                None
            } else {
                Some(agent.system_prompt.clone())
            },
        };

        let backend = create_backend(&backend_type, config);

        Ok(Self {
            agent_id: agent.id.clone(),
            backend,
        })
    }

    /// Handle a user message with streaming, emitting chunks via Tauri events.
    pub async fn handle_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        app_handle: tauri::AppHandle,
    ) -> Result<String, AiError> {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        let agent_id = self.agent_id.clone();
        let emit_handle = app_handle.clone();

        let emit_task = tokio::spawn(async move {
            while let Some(chunk) = rx.recv().await {
                let payload = ChatStreamPayload {
                    agent_id: agent_id.clone(),
                    chunk,
                    done: false,
                };
                let _ = emit_handle.emit("chat-stream", &payload);
            }
        });

        let result = self.backend.send_message_streaming(messages, tx).await;

        let _ = emit_task.await;

        let done_payload = ChatStreamPayload {
            agent_id: self.agent_id.clone(),
            chunk: String::new(),
            done: true,
        };
        let _ = app_handle.emit("chat-stream", &done_payload);

        result
    }
}
