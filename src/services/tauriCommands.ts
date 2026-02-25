import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Agent, Task, Message, Channel } from "./types";

// ─── Backend-aligned types ───

interface BackendAgent {
  id: string;
  name: string;
  role: string;
  department: string;
  personality: string;
  system_prompt: string;
  tools: string;
  status: string;
  model: string;
  avatar: string;
  created_at: string;
}

interface BackendMessage {
  id: string;
  channel: string;
  sender: string;
  content: string;
  timestamp: string;
  metadata: string;
}

interface ChatStreamPayload {
  agent_id: string;
  chunk: string;
  done: boolean;
}

// ─── Adapters ───

function toAgent(b: BackendAgent): Agent {
  return {
    id: b.id,
    name: b.name,
    role: b.role,
    status: b.status === "idle" ? "online" : b.status === "working" ? "busy" : b.status === "error" ? "error" : "offline",
    avatar: b.avatar || undefined,
    currentTask: b.status === "working" ? "작업 중..." : undefined,
    completedTasks: 0,
    totalTasks: 0,
  };
}

function toMessage(b: BackendMessage, channelId: string): Message {
  return {
    id: b.id,
    channelId,
    role: b.sender === "user" ? "user" : "assistant",
    content: b.content,
    timestamp: b.timestamp,
    agentId: b.sender !== "user" ? b.sender : undefined,
  };
}

// ─── Check if running in Tauri ───

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// ─── Mock data for browser dev ───

const mockAgents: Agent[] = [
  {
    id: "secretary-kim",
    name: "김비서",
    role: "비서",
    status: "online",
    avatar: "👩‍💼",
    currentTask: undefined,
    completedTasks: 12,
    totalTasks: 15,
  },
];

const mockChannels: Channel[] = [
  {
    id: "secretary-kim",
    name: "김비서",
    agentId: "secretary-kim",
    lastMessage: "안녕하세요, 김비서입니다. 무엇을 도와드릴까요?",
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
  },
];

const mockMessages: Message[] = [];

// ─── API Functions ───

export async function getAgents(): Promise<Agent[]> {
  if (!isTauri()) return mockAgents;
  try {
    const agents: BackendAgent[] = await invoke("get_agents");
    return agents.map(toAgent);
  } catch {
    return mockAgents;
  }
}

export async function getTasks(): Promise<Task[]> {
  // Tasks not yet exposed via backend command, return empty
  return [];
}

export async function getChannels(): Promise<Channel[]> {
  if (!isTauri()) return mockChannels;
  try {
    const agents: BackendAgent[] = await invoke("get_agents");
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      agentId: a.id,
      unreadCount: 0,
    }));
  } catch {
    return mockChannels;
  }
}

export async function getMessages(channelId: string): Promise<Message[]> {
  if (!isTauri()) return mockMessages.filter((m) => m.channelId === channelId);
  try {
    const messages: BackendMessage[] = await invoke("get_messages", {
      channel: channelId,
      limit: 100,
    });
    return messages.map((m) => toMessage(m, channelId));
  } catch {
    return [];
  }
}

export async function sendMessage(
  channelId: string,
  content: string
): Promise<Message> {
  if (!isTauri()) {
    const userMsg: Message = {
      id: `msg-${Date.now()}`,
      channelId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    mockMessages.push(userMsg);
    return userMsg;
  }

  try {
    const result: BackendMessage = await invoke("send_message", {
      request: {
        channel: channelId,
        sender: "user",
        content,
      },
    });
    return toMessage(result, channelId);
  } catch {
    return {
      id: `msg-${Date.now()}`,
      channelId,
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
  }
}

export async function chatWithAgent(
  agentId: string,
  message: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isTauri()) {
    // Mock streaming simulation
    return {
      success: true,
      message: "네, 알겠습니다. 바로 처리하겠습니다.",
    };
  }

  return invoke("chat_with_agent", {
    agentId,
    message,
  });
}

export async function listenChatStream(
  callback: (payload: ChatStreamPayload) => void
): Promise<UnlistenFn> {
  if (!isTauri()) {
    return () => {};
  }
  return listen<ChatStreamPayload>("chat-stream", (event) => {
    callback(event.payload);
  });
}

// Legacy mock function (for backward compat during transition)
export async function getAgentResponse(
  channelId: string,
  _userMessage: string
): Promise<Message> {
  const responses = [
    "알겠습니다. 바로 처리하겠습니다.",
    "네, 확인했습니다. 잠시만 기다려주세요.",
    "해당 업무를 진행 중입니다. 완료되면 보고드리겠습니다.",
  ];
  const response: Message = {
    id: `msg-${Date.now()}`,
    channelId,
    role: "assistant",
    content: responses[Math.floor(Math.random() * responses.length)],
    timestamp: new Date().toISOString(),
    agentId: "secretary-kim",
  };
  mockMessages.push(response);
  return response;
}
