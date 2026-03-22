use serde::{Deserialize, Serialize};

// ── Non-streaming chat completion response ──

/// Top-level response from /chat/completions (non-streaming).
#[derive(Debug, Deserialize)]
pub struct CompletionResponse {
    #[serde(default)]
    pub choices: Vec<CompletionChoice>,
}

#[derive(Debug, Deserialize)]
pub struct CompletionChoice {
    #[serde(default)]
    pub message: Option<ResponseMessage>,
}

#[derive(Debug, Deserialize)]
pub struct ResponseMessage {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<ResponseToolCall>>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseToolCall {
    pub id: String,
    pub function: ResponseToolCallFunction,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct ResponseToolCallFunction {
    pub name: String,
    pub arguments: String,
}

// ── Streaming chunk ──

/// A single SSE chunk from a streaming /chat/completions call.
#[derive(Debug, Deserialize)]
pub struct CompletionChunk {
    #[serde(default)]
    pub choices: Vec<ChunkChoice>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkChoice {
    #[serde(default)]
    pub delta: Option<ChunkDelta>,
}

#[derive(Debug, Deserialize)]
pub struct ChunkDelta {
    #[serde(default)]
    pub content: Option<String>,
    #[serde(default)]
    pub reasoning_content: Option<String>,
    #[serde(default)]
    pub tool_calls: Option<Vec<crate::api::ToolCallDelta>>,
}

// ── Models list ──

/// Response from /models endpoint.
#[derive(Debug, Deserialize)]
pub struct ModelsResponse {
    #[serde(default)]
    pub data: Vec<ModelEntry>,
}

#[derive(Debug, Deserialize)]
pub struct ModelEntry {
    pub id: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_completion_response_full() {
        let json = r#"{
            "choices": [{
                "message": {
                    "content": "Hello!",
                    "reasoning_content": "Thinking..."
                }
            }]
        }"#;
        let resp: CompletionResponse = serde_json::from_str(json).unwrap();
        let msg = resp.choices[0].message.as_ref().unwrap();
        assert_eq!(msg.content.as_deref(), Some("Hello!"));
        assert_eq!(msg.reasoning_content.as_deref(), Some("Thinking..."));
    }

    #[test]
    fn test_completion_response_empty_choices() {
        let json = r#"{"choices": []}"#;
        let resp: CompletionResponse = serde_json::from_str(json).unwrap();
        assert!(resp.choices.is_empty());
    }

    #[test]
    fn test_completion_response_missing_fields() {
        let json = r#"{"choices": [{"message": {}}]}"#;
        let resp: CompletionResponse = serde_json::from_str(json).unwrap();
        let msg = resp.choices[0].message.as_ref().unwrap();
        assert!(msg.content.is_none());
        assert!(msg.reasoning_content.is_none());
    }

    #[test]
    fn test_chunk_with_tool_calls() {
        let json = r#"{
            "choices": [{
                "delta": {
                    "tool_calls": [{
                        "index": 0,
                        "id": "call_123",
                        "function": { "name": "search", "arguments": "{}" }
                    }]
                }
            }]
        }"#;
        let chunk: CompletionChunk = serde_json::from_str(json).unwrap();
        let delta = chunk.choices[0].delta.as_ref().unwrap();
        let tc = delta.tool_calls.as_ref().unwrap();
        assert_eq!(tc.len(), 1);
        assert_eq!(tc[0].index, 0);
        assert_eq!(tc[0].id.as_deref(), Some("call_123"));
    }

    #[test]
    fn test_models_response() {
        let json = r#"{"data": [{"id": "gpt-4"}, {"id": "gpt-3.5-turbo"}]}"#;
        let resp: ModelsResponse = serde_json::from_str(json).unwrap();
        assert_eq!(resp.data.len(), 2);
        assert_eq!(resp.data[0].id, "gpt-4");
    }
}
