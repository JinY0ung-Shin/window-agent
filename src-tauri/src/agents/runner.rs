use tokio::sync::mpsc;
use tauri::Emitter;

use crate::ai::backend::{AiBackend, AiError};
use crate::ai::factory::create_backend;
use crate::ai::types::{AiBackendType, ApiConfig, ChatMessage, ChatStreamPayload};
use crate::db::models::Agent;

/// Load a persona file for an agent using compile-time embedding.
/// Returns the content of soul.md, identity.md, or instructions.md for the given agent.
fn load_persona_file(agent_id: &str, file_name: &str) -> Option<&'static str> {
    match (agent_id, file_name) {
        ("secretary-kim", "soul") => Some(include_str!("../../data/agents/secretary-kim/soul.md")),
        ("secretary-kim", "identity") => Some(include_str!("../../data/agents/secretary-kim/identity.md")),
        ("secretary-kim", "instructions") => Some(include_str!("../../data/agents/secretary-kim/instructions.md")),

        ("developer-park", "soul") => Some(include_str!("../../data/agents/developer-park/soul.md")),
        ("developer-park", "identity") => Some(include_str!("../../data/agents/developer-park/identity.md")),
        ("developer-park", "instructions") => Some(include_str!("../../data/agents/developer-park/instructions.md")),

        ("analyst-lee", "soul") => Some(include_str!("../../data/agents/analyst-lee/soul.md")),
        ("analyst-lee", "identity") => Some(include_str!("../../data/agents/analyst-lee/identity.md")),
        ("analyst-lee", "instructions") => Some(include_str!("../../data/agents/analyst-lee/instructions.md")),

        ("planner-choi", "soul") => Some(include_str!("../../data/agents/planner-choi/soul.md")),
        ("planner-choi", "identity") => Some(include_str!("../../data/agents/planner-choi/identity.md")),
        ("planner-choi", "instructions") => Some(include_str!("../../data/agents/planner-choi/instructions.md")),

        ("researcher-jung", "soul") => Some(include_str!("../../data/agents/researcher-jung/soul.md")),
        ("researcher-jung", "identity") => Some(include_str!("../../data/agents/researcher-jung/identity.md")),
        ("researcher-jung", "instructions") => Some(include_str!("../../data/agents/researcher-jung/instructions.md")),

        ("designer-han", "soul") => Some(include_str!("../../data/agents/designer-han/soul.md")),
        ("designer-han", "identity") => Some(include_str!("../../data/agents/designer-han/identity.md")),
        ("designer-han", "instructions") => Some(include_str!("../../data/agents/designer-han/instructions.md")),

        ("sysadmin-kang", "soul") => Some(include_str!("../../data/agents/sysadmin-kang/soul.md")),
        ("sysadmin-kang", "identity") => Some(include_str!("../../data/agents/sysadmin-kang/identity.md")),
        ("sysadmin-kang", "instructions") => Some(include_str!("../../data/agents/sysadmin-kang/instructions.md")),

        ("automator-yoon", "soul") => Some(include_str!("../../data/agents/automator-yoon/soul.md")),
        ("automator-yoon", "identity") => Some(include_str!("../../data/agents/automator-yoon/identity.md")),
        ("automator-yoon", "instructions") => Some(include_str!("../../data/agents/automator-yoon/instructions.md")),

        _ => None,
    }
}

/// Compose a full system prompt from persona files (soul + identity + instructions)
/// and the DB system_prompt. Falls back to DB prompt if persona files don't exist.
fn compose_system_prompt(agent_id: &str, db_system_prompt: &str) -> Option<String> {
    let soul = load_persona_file(agent_id, "soul");
    let identity = load_persona_file(agent_id, "identity");
    let instructions = load_persona_file(agent_id, "instructions");

    // If any persona files exist, compose them together
    if soul.is_some() || identity.is_some() || instructions.is_some() {
        let mut parts: Vec<&str> = Vec::new();

        if let Some(s) = soul {
            parts.push(s);
        }
        if let Some(i) = identity {
            parts.push(i);
        }
        if let Some(inst) = instructions {
            parts.push(inst);
        }

        // Append DB system_prompt at the end (highest priority overrides)
        if !db_system_prompt.is_empty() {
            parts.push(db_system_prompt);
        }

        Some(parts.join("\n\n---\n\n"))
    } else if !db_system_prompt.is_empty() {
        // Fallback: use DB system_prompt only
        Some(db_system_prompt.to_string())
    } else {
        None
    }
}

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

        // Compose system prompt from persona files + DB prompt
        let system_prompt = compose_system_prompt(&agent.id, &agent.system_prompt);

        let config = ApiConfig {
            api_key,
            api_url,
            model,
            max_tokens: 4096,
            system_prompt,
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
