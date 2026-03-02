export type AgentStatus = "online" | "busy" | "offline" | "error";
export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type MessageRole = "user" | "assistant" | "system";
export type AiBackendType = "claude" | "openai" | "ollama" | "custom";
export type PermissionLevel = "none" | "ask" | "auto";

export interface Agent {
  id: string;
  name: string;
  role: string;
  department: string;
  personality: string;
  systemPrompt: string;
  tools: string;
  status: AgentStatus;
  model: string;
  avatar: string;
  aiBackend: AiBackendType;
  apiUrl: string;
  apiKey: string;
  isActive: boolean;
  hiredAt?: string;
  firedAt?: string;
  currentTask?: string;
  completedTasks: number;
  totalTasks: number;
  onLeave?: boolean;
  leaveStartedAt?: string;
  leaveReason?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId?: string;
  creator?: string;
  parentTaskId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

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
  avatar?: string;
  lastMessage?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

export interface Department {
  id: string;
  name: string;
  description: string;
  createdAt: string;
}

export interface Permission {
  id: string;
  agentId: string;
  permissionType: string;
  level: PermissionLevel;
}

export interface FolderEntry {
  id: string;
  agentId: string;
  path: string;
  createdAt: string;
}

export interface ProgramEntry {
  id: string;
  agentId: string;
  program: string;
  createdAt: string;
}

export interface AgentMessage {
  id: string;
  fromAgent: string;
  toAgent: string;
  content: string;
  timestamp: string;
  read: boolean;
}

export interface CreateAgentRequest {
  name: string;
  role: string;
  department: string;
  personality: string;
  systemPrompt: string;
  tools: string;
  model: string;
  avatar: string;
  aiBackend: AiBackendType;
  apiUrl?: string;
  apiKey?: string;
}

export interface UpdateAgentRequest {
  name?: string;
  role?: string;
  department?: string;
  personality?: string;
  systemPrompt?: string;
  tools?: string;
  model?: string;
  avatar?: string;
  aiBackend?: AiBackendType;
  apiUrl?: string;
  apiKey?: string;
}

export interface CreateTaskRequest {
  title: string;
  description: string;
  assigneeId?: string;
  priority: TaskPriority;
  parentTaskId?: string;
  creator?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  description?: string;
  assigneeId?: string;
  priority?: TaskPriority;
  status?: TaskStatus;
  parentTaskId?: string;
}

// ─── Phase 3 Types ───

export type ReportType = "daily" | "weekly" | "monthly";

export interface Report {
  id: string;
  reportType: ReportType;
  title: string;
  content: string;
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  metadata: string;
}

export interface Evaluation {
  id: string;
  agentId: string;
  period: string;
  taskSuccessRate: number;
  avgCompletionTimeSecs: number;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalCostUsd: number;
  score: number;
  evaluationNotes: string;
  createdAt: string;
}

export interface PerformanceSummary {
  agentId: string;
  taskSuccessRate: number;
  avgTimeSecs: number;
  totalTasks: number;
  totalCost: number;
  score: number;
  trend: "up" | "down" | "stable";
}

export interface OrgChartNode {
  department: Department;
  agents: Agent[];
}

export interface AgentBackup {
  id: string;
  agentId: string;
  configJson: string;
  reason: string;
  backedUpAt: string;
  restoredAt?: string;
}

export interface ScheduledTask {
  id: string;
  title: string;
  description: string;
  cronExpression: string;
  assignee?: string;
  priority: TaskPriority;
  isActive: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface CreateScheduledTaskRequest {
  title: string;
  description: string;
  cronExpression: string;
  assignee?: string;
  priority: string;
}

export interface UpdateScheduledTaskRequest {
  title?: string;
  description?: string;
  cronExpression?: string;
  assignee?: string;
  priority?: string;
  isActive?: boolean;
}

export interface CostRecord {
  id: string;
  agentId: string;
  toolExecutionId?: string;
  model: string;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  timestamp: string;
}

export interface CostSummary {
  totalCost: number;
  totalTokens: number;
  byAgent: AgentCostBreakdown[];
  byModel: ModelCostBreakdown[];
}

export interface AgentCostBreakdown {
  agentId: string;
  agentName: string;
  costUsd: number;
  tokens: number;
  callCount: number;
}

export interface ModelCostBreakdown {
  model: string;
  costUsd: number;
  tokens: number;
}

export interface DailyCost {
  date: string;
  costUsd: number;
  tokens: number;
}
