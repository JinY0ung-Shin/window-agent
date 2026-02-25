use crate::ai::backend::AiBackend;
use crate::ai::claude::ClaudeClient;
use crate::ai::ollama::OllamaClient;
use crate::ai::openai::OpenAiClient;
use crate::ai::types::{AiBackendType, ApiConfig};

pub fn create_backend(backend_type: &AiBackendType, config: ApiConfig) -> Box<dyn AiBackend> {
    match backend_type {
        AiBackendType::Claude => Box::new(ClaudeClient::new(config)),
        AiBackendType::OpenAI | AiBackendType::Custom => Box::new(OpenAiClient::new(config)),
        AiBackendType::Ollama => Box::new(OllamaClient::new(config)),
    }
}
