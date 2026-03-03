// DB models (match Rust structs)
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface DbMessage {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  created_at: string;
}

export interface SaveMessageRequest {
  conversation_id: string;
  role: string;
  content: string;
}

// UI model
export interface ChatMessage {
  id: string;
  type: "user" | "agent";
  content: string;
  reasoningContent?: string;
  isLoading?: boolean;
}
