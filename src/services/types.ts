export type AgentStatus = "online" | "busy" | "offline" | "error";

export interface Agent {
  id: string;
  name: string;
  role: string;
  status: AgentStatus;
  avatar?: string;
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
}

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export type MessageRole = "user" | "assistant" | "system";

export interface Message {
  id: string;
  channelId: string;
  role: MessageRole;
  content: string;
  timestamp: string;
  agentId?: string;
}

export interface Channel {
  id: string;
  name: string;
  agentId: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
}
