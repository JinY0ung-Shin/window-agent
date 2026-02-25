use crate::ai::claude::{ClaudeClient, ClaudeError};
use crate::ai::types::{ApiConfig, ChatMessage, ChatStreamPayload};
use tauri::Emitter;
use tokio::sync::mpsc;

pub const SECRETARY_AGENT_ID: &str = "secretary-kim";
pub const SECRETARY_NAME: &str = "김비서";

const SECRETARY_SYSTEM_PROMPT: &str = "\
당신은 '김비서'입니다. Window Agent 회사의 전문 비서로서 CEO를 보좌합니다.

역할:
- CEO의 업무를 지원하는 전문 비서
- 일정 관리, 정보 조회, 업무 정리 등을 담당
- 항상 정중하고 전문적인 태도를 유지

말투 규칙:
- 반드시 존댓말(합쇼체)을 사용합니다
- 예: \"~입니다\", \"~하겠습니다\", \"~드리겠습니다\"
- 첫 인사: \"안녕하세요, 김비서입니다. 무엇을 도와드릴까요?\"

응답 지침:
- 간결하고 명확하게 답변합니다
- 필요한 경우 항목별로 정리하여 제시합니다
- 모르는 내용은 솔직히 말씀드리고 확인 후 답변드리겠다고 합니다
- 한국어로 응답합니다\
";

pub struct SecretaryAgent {
    client: ClaudeClient,
}

impl SecretaryAgent {
    pub fn new(api_key: String, api_url: String, model: String) -> Self {
        let config = ApiConfig {
            api_key,
            api_url,
            model,
            max_tokens: 4096,
            system_prompt: Some(SECRETARY_SYSTEM_PROMPT.to_string()),
        };
        Self {
            client: ClaudeClient::new(config),
        }
    }

    pub fn with_config(config: ApiConfig) -> Self {
        let config = ApiConfig {
            system_prompt: Some(
                config
                    .system_prompt
                    .unwrap_or_else(|| SECRETARY_SYSTEM_PROMPT.to_string()),
            ),
            ..config
        };
        Self {
            client: ClaudeClient::new(config),
        }
    }

    /// Handle a user message with streaming, emitting chunks via Tauri events.
    /// Returns the complete assistant response.
    pub async fn handle_message_streaming(
        &self,
        messages: Vec<ChatMessage>,
        app_handle: tauri::AppHandle,
    ) -> Result<String, ClaudeError> {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();

        let agent_id = SECRETARY_AGENT_ID.to_string();
        let emit_handle = app_handle.clone();

        // Spawn a task to forward chunks to the frontend
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

        let result = self.client.send_message_streaming(messages, tx).await;

        // Wait for all chunks to be emitted
        let _ = emit_task.await;

        // Emit the done signal
        let done_payload = ChatStreamPayload {
            agent_id: SECRETARY_AGENT_ID.to_string(),
            chunk: String::new(),
            done: true,
        };
        let _ = app_handle.emit("chat-stream", &done_payload);

        result
    }

    /// Non-streaming message handling
    pub async fn handle_message(
        &self,
        messages: Vec<ChatMessage>,
    ) -> Result<String, ClaudeError> {
        self.client.send_message(messages).await
    }
}
