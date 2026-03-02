import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Agent,
  Task,
  Message,
  Channel,
  Department,
  Permission,
  FolderEntry,
  ProgramEntry,
  AgentMessage,
  CreateAgentRequest,
  UpdateAgentRequest,
  CreateTaskRequest,
  UpdateTaskRequest,
  OrgChartNode,
  AgentBackup,
  ScheduledTask,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  CostRecord,
  CostSummary,
  DailyCost,
  Report,
  Evaluation,
  PerformanceSummary,
} from "./types";

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
  ai_backend: string;
  api_url: string;
  api_key: string;
  is_active: boolean;
  hired_at?: string;
  fired_at?: string;
  created_at: string;
  on_leave?: number;
  leave_started_at?: string;
  leave_reason?: string;
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
    department: b.department || "",
    personality: b.personality || "",
    systemPrompt: b.system_prompt || "",
    tools: b.tools || "",
    status: b.status === "idle" ? "online" : b.status === "working" ? "busy" : b.status === "error" ? "error" : "offline",
    model: b.model || "",
    avatar: b.avatar || "",
    aiBackend: (b.ai_backend as Agent["aiBackend"]) || "claude",
    apiUrl: b.api_url || "",
    apiKey: b.api_key || "",
    isActive: b.is_active !== false,
    hiredAt: b.hired_at || b.created_at,
    firedAt: b.fired_at,
    currentTask: b.status === "working" ? "작업 중..." : undefined,
    completedTasks: 0,
    totalTasks: 0,
    onLeave: !!b.on_leave,
    leaveStartedAt: b.leave_started_at,
    leaveReason: b.leave_reason || "",
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

// ─── Simple UUID generator ───

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback for environments without crypto.randomUUID
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Mock data for browser dev ───

const mockAgents: Agent[] = [
  {
    id: "secretary-kim",
    name: "김비서",
    role: "비서",
    department: "경영지원",
    personality: "친절하고 꼼꼼한 비서",
    systemPrompt: "당신은 유능한 비서입니다.",
    tools: "calendar,email,search",
    status: "online",
    model: "claude-sonnet-4-20250514",
    avatar: "👩‍💼",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-01-15T09:00:00Z",
    currentTask: undefined,
    completedTasks: 12,
    totalTasks: 15,
  },
  {
    id: "developer-park",
    name: "박개발",
    role: "개발자",
    department: "개발팀",
    personality: "논리적이고 효율적인 개발자",
    systemPrompt: "당신은 숙련된 개발자입니다.",
    tools: "code,terminal,git",
    status: "busy",
    model: "claude-sonnet-4-20250514",
    avatar: "💻",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-01-20T09:00:00Z",
    currentTask: "API 리팩토링",
    completedTasks: 8,
    totalTasks: 10,
  },
  {
    id: "analyst-lee",
    name: "이분석",
    role: "분석가",
    department: "분석팀",
    personality: "데이터 기반으로 사고하는 분석가",
    systemPrompt: "당신은 데이터 분석 전문가입니다.",
    tools: "data,chart,report",
    status: "online",
    model: "claude-sonnet-4-20250514",
    avatar: "📊",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-02-01T09:00:00Z",
    currentTask: undefined,
    completedTasks: 5,
    totalTasks: 7,
  },
  {
    id: "planner-choi",
    name: "최기획",
    role: "기획자",
    department: "기획팀",
    personality: "창의적이고 전략적인 기획자",
    systemPrompt: "당신은 전략 기획 전문가입니다.",
    tools: "docs,presentation,research",
    status: "online",
    model: "claude-sonnet-4-20250514",
    avatar: "📝",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-02-05T09:00:00Z",
    currentTask: undefined,
    completedTasks: 3,
    totalTasks: 5,
  },
  {
    id: "researcher-jung",
    name: "정조사",
    role: "조사원",
    department: "조사팀",
    personality: "꼼꼼하고 탐구적인 조사원",
    systemPrompt: "당신은 리서치 전문가입니다.",
    tools: "search,web,summary",
    status: "offline",
    model: "claude-sonnet-4-20250514",
    avatar: "🔍",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-02-10T09:00:00Z",
    currentTask: undefined,
    completedTasks: 6,
    totalTasks: 8,
  },
  {
    id: "designer-han",
    name: "한디자",
    role: "디자이너",
    department: "디자인팀",
    personality: "감각적이고 세심한 디자이너",
    systemPrompt: "당신은 UI/UX 디자인 전문가입니다.",
    tools: "design,image,mockup",
    status: "busy",
    model: "claude-sonnet-4-20250514",
    avatar: "🎨",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-02-15T09:00:00Z",
    currentTask: "대시보드 디자인",
    completedTasks: 4,
    totalTasks: 6,
  },
  {
    id: "sysadmin-kang",
    name: "강관리",
    role: "시스템관리자",
    department: "시스템관리",
    personality: "체계적이고 신뢰감 있는 관리자",
    systemPrompt: "당신은 시스템 관리 전문가입니다.",
    tools: "filesystem,process,monitor",
    status: "online",
    model: "claude-sonnet-4-20250514",
    avatar: "📁",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-03-01T09:00:00Z",
    currentTask: undefined,
    completedTasks: 10,
    totalTasks: 12,
  },
  {
    id: "automator-yoon",
    name: "윤자동",
    role: "자동화전문가",
    department: "자동화팀",
    personality: "효율을 추구하는 자동화 전문가",
    systemPrompt: "당신은 업무 자동화 전문가입니다.",
    tools: "automation,script,scheduler",
    status: "online",
    model: "claude-sonnet-4-20250514",
    avatar: "🔧",
    aiBackend: "claude",
    apiUrl: "",
    apiKey: "",
    isActive: true,
    hiredAt: "2025-03-10T09:00:00Z",
    currentTask: undefined,
    completedTasks: 7,
    totalTasks: 9,
  },
];

const mockChannels: Channel[] = mockAgents
  .filter((a) => a.isActive)
  .map((a) => ({
    id: a.id,
    name: a.name,
    agentId: a.id,
    avatar: a.avatar,
    lastMessage: a.id === "secretary-kim" ? "안녕하세요, 김비서입니다. 무엇을 도와드릴까요?" : undefined,
    lastMessageAt: a.id === "secretary-kim" ? new Date().toISOString() : undefined,
    unreadCount: 0,
  }));

const mockMessages: Message[] = [];

const mockTasks: Task[] = [
  {
    id: "task-1",
    title: "주간 보고서 작성",
    description: "이번 주 업무 진행 상황을 정리하여 보고서를 작성합니다.",
    status: "in_progress",
    priority: "high",
    assigneeId: "secretary-kim",
    creator: "user",
    createdAt: "2025-03-20T09:00:00Z",
    updatedAt: "2025-03-20T09:00:00Z",
  },
  {
    id: "task-2",
    title: "API 엔드포인트 리팩토링",
    description: "기존 REST API를 최적화하고 새로운 엔드포인트를 추가합니다.",
    status: "in_progress",
    priority: "urgent",
    assigneeId: "developer-park",
    creator: "user",
    createdAt: "2025-03-19T10:00:00Z",
    updatedAt: "2025-03-20T14:00:00Z",
  },
  {
    id: "task-3",
    title: "사용자 데이터 분석",
    description: "최근 한 달간의 사용자 행동 데이터를 분석합니다.",
    status: "pending",
    priority: "medium",
    assigneeId: "analyst-lee",
    creator: "user",
    createdAt: "2025-03-20T11:00:00Z",
    updatedAt: "2025-03-20T11:00:00Z",
  },
  {
    id: "task-4",
    title: "신규 기능 기획안",
    description: "다음 분기 출시 예정인 신규 기능의 기획안을 작성합니다.",
    status: "pending",
    priority: "medium",
    assigneeId: "planner-choi",
    creator: "user",
    createdAt: "2025-03-18T09:00:00Z",
    updatedAt: "2025-03-18T09:00:00Z",
  },
  {
    id: "task-5",
    title: "경쟁사 시장 조사",
    description: "주요 경쟁사의 최근 동향과 시장 트렌드를 조사합니다.",
    status: "completed",
    priority: "low",
    assigneeId: "researcher-jung",
    creator: "user",
    createdAt: "2025-03-15T09:00:00Z",
    updatedAt: "2025-03-19T17:00:00Z",
    completedAt: "2025-03-19T17:00:00Z",
  },
  {
    id: "task-6",
    title: "대시보드 UI 개선",
    description: "대시보드의 레이아웃과 시각적 요소를 개선합니다.",
    status: "in_progress",
    priority: "high",
    assigneeId: "designer-han",
    creator: "user",
    createdAt: "2025-03-17T09:00:00Z",
    updatedAt: "2025-03-20T10:00:00Z",
  },
];

const mockDepartments: Department[] = [
  { id: "dept-1", name: "경영지원", description: "경영 지원 및 비서 업무", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-2", name: "개발팀", description: "소프트웨어 개발 및 유지보수", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-3", name: "분석팀", description: "데이터 분석 및 리포팅", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-4", name: "기획팀", description: "전략 기획 및 프로젝트 관리", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-5", name: "조사팀", description: "시장 조사 및 리서치", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-6", name: "디자인팀", description: "UI/UX 디자인", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-7", name: "시스템관리", description: "시스템 관리 및 모니터링", createdAt: "2025-01-01T00:00:00Z" },
  { id: "dept-8", name: "자동화팀", description: "업무 자동화 및 스크립팅", createdAt: "2025-01-01T00:00:00Z" },
];

// ─── API Functions ───

export async function getAgents(): Promise<Agent[]> {
  if (!isTauri()) return mockAgents;
  try {
    const agents: BackendAgent[] = await invoke("get_agents");
    return agents.map(toAgent);
  } catch (e) {
    console.error("get_agents failed:", e);
    throw e;
  }
}

export async function getTasks(): Promise<Task[]> {
  if (!isTauri()) return mockTasks;
  try {
    return await invoke("get_all_tasks");
  } catch (e) {
    console.error("get_all_tasks failed:", e);
    throw e;
  }
}

export async function getChannels(): Promise<Channel[]> {
  if (!isTauri()) return mockChannels;
  try {
    const agents: BackendAgent[] = await invoke("get_agents");
    return agents.map((a) => ({
      id: a.id,
      name: a.name,
      agentId: a.id,
      avatar: a.avatar || undefined,
      unreadCount: 0,
    }));
  } catch (e) {
    console.error("get_agents (channels) failed:", e);
    throw e;
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
  } catch (e) {
    console.error("get_messages failed:", e);
    throw e;
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
  } catch (e) {
    console.error("send_message failed:", e);
    throw e;
  }
}

export async function chatWithAgent(
  agentId: string,
  message: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  if (!isTauri()) {
    return {
      success: true,
      message: "네, 알겠습니다. 바로 처리하겠습니다.",
    };
  }

  return invoke("chat_with_agent", {
    agent_id: agentId,
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
    agentId: channelId,
  };
  mockMessages.push(response);
  return response;
}

// ─── HR Commands ───

export async function hireAgent(request: CreateAgentRequest): Promise<Agent> {
  if (!isTauri()) {
    const newAgent: Agent = {
      id: `agent-${Date.now()}`,
      ...request,
      apiUrl: request.apiUrl || "",
      apiKey: request.apiKey || "",
      status: "online",
      isActive: true,
      hiredAt: new Date().toISOString(),
      completedTasks: 0,
      totalTasks: 0,
    };
    mockAgents.push(newAgent);
    return newAgent;
  }
  try {
    const b: BackendAgent = await invoke("hire_agent", {
      request: {
        id: request.id || generateId(),
        name: request.name,
        role: request.role,
        department: request.department,
        personality: request.personality,
        system_prompt: request.systemPrompt,
        tools: request.tools,
        model: request.model,
        avatar: request.avatar,
        ai_backend: request.aiBackend,
        api_url: request.apiUrl || "",
        api_key: request.apiKey || "",
      },
    });
    return toAgent(b);
  } catch (e) {
    console.error("hire_agent failed:", e);
    throw e;
  }
}

export async function fireAgent(agentId: string): Promise<boolean> {
  if (!isTauri()) {
    const idx = mockAgents.findIndex((a) => a.id === agentId);
    if (idx !== -1) {
      mockAgents[idx].isActive = false;
      mockAgents[idx].firedAt = new Date().toISOString();
      mockAgents[idx].status = "offline";
    }
    return true;
  }
  try {
    return await invoke("fire_agent", { agent_id: agentId });
  } catch (e) {
    console.error("fire_agent failed:", e);
    throw e;
  }
}

export async function updateAgent(agentId: string, request: UpdateAgentRequest): Promise<Agent> {
  if (!isTauri()) {
    const idx = mockAgents.findIndex((a) => a.id === agentId);
    if (idx !== -1) {
      const updated = { ...mockAgents[idx], ...request };
      mockAgents[idx] = updated;
      return updated;
    }
    throw new Error("Agent not found");
  }
  try {
    const b: BackendAgent = await invoke("update_agent", {
      agent_id: agentId,
      request: {
        name: request.name,
        role: request.role,
        department: request.department,
        personality: request.personality,
        system_prompt: request.systemPrompt,
        tools: request.tools,
        model: request.model,
        avatar: request.avatar,
        ai_backend: request.aiBackend,
        api_key: request.apiKey,
        api_url: request.apiUrl,
      },
    });
    return toAgent(b);
  } catch (e) {
    console.error("update_agent failed:", e);
    throw e;
  }
}

export async function getDepartments(): Promise<Department[]> {
  if (!isTauri()) return mockDepartments;
  try {
    return await invoke("get_departments");
  } catch (e) {
    console.error("get_departments failed:", e);
    throw e;
  }
}

export async function createDepartment(name: string, description: string): Promise<Department> {
  if (!isTauri()) {
    const dept: Department = {
      id: `dept-${Date.now()}`,
      name,
      description,
      createdAt: new Date().toISOString(),
    };
    mockDepartments.push(dept);
    return dept;
  }
  try {
    return await invoke("create_department", { name, description });
  } catch (e) {
    console.error("create_department failed:", e);
    throw e;
  }
}

// ─── Task Commands ───

export async function createTask(request: CreateTaskRequest): Promise<Task> {
  if (!isTauri()) {
    const task: Task = {
      id: `task-${Date.now()}`,
      ...request,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    mockTasks.push(task);
    return task;
  }
  try {
    return await invoke("create_task", {
      request: {
        title: request.title,
        description: request.description,
        assignee: request.assigneeId,
        priority: request.priority,
        parent_task_id: request.parentTaskId,
        creator: request.creator,
      },
    });
  } catch (e) {
    console.error("create_task failed:", e);
    throw e;
  }
}

export async function updateTask(taskId: string, request: UpdateTaskRequest): Promise<Task> {
  if (!isTauri()) {
    const idx = mockTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      mockTasks[idx] = { ...mockTasks[idx], ...request, updatedAt: new Date().toISOString() };
      return mockTasks[idx];
    }
    throw new Error("Task not found");
  }
  try {
    return await invoke("update_task", {
      task_id: taskId,
      request: {
        title: request.title,
        description: request.description,
        assignee: request.assigneeId,
        status: request.status,
        priority: request.priority,
        parent_task_id: request.parentTaskId,
      },
    });
  } catch (e) {
    console.error("update_task failed:", e);
    throw e;
  }
}

export async function deleteTask(taskId: string): Promise<boolean> {
  if (!isTauri()) {
    const idx = mockTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      mockTasks.splice(idx, 1);
    }
    return true;
  }
  try {
    return await invoke("delete_task", { task_id: taskId });
  } catch (e) {
    console.error("delete_task failed:", e);
    throw e;
  }
}

export async function getAllTasks(): Promise<Task[]> {
  if (!isTauri()) return mockTasks;
  try {
    return await invoke("get_all_tasks");
  } catch (e) {
    console.error("get_all_tasks failed:", e);
    throw e;
  }
}

export async function getTasksByStatus(status: string): Promise<Task[]> {
  if (!isTauri()) return mockTasks.filter((t) => t.status === status);
  try {
    return await invoke("get_tasks_by_status", { status });
  } catch (e) {
    console.error("get_tasks_by_status failed:", e);
    throw e;
  }
}

export async function updateTaskStatus(taskId: string, status: string): Promise<Task> {
  if (!isTauri()) {
    const idx = mockTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      mockTasks[idx].status = status as Task["status"];
      mockTasks[idx].updatedAt = new Date().toISOString();
      if (status === "completed") {
        mockTasks[idx].completedAt = new Date().toISOString();
      }
      return mockTasks[idx];
    }
    throw new Error("Task not found");
  }
  try {
    return await invoke("update_task_status_cmd", { task_id: taskId, status });
  } catch (e) {
    console.error("update_task_status_cmd failed:", e);
    throw e;
  }
}

// ─── Permission Commands ───

export async function getPermissions(agentId: string): Promise<Permission[]> {
  if (!isTauri()) {
    return [
      { id: `perm-1-${agentId}`, agentId, permissionType: "file_read", level: "auto" },
      { id: `perm-2-${agentId}`, agentId, permissionType: "file_write", level: "ask" },
      { id: `perm-3-${agentId}`, agentId, permissionType: "network", level: "ask" },
      { id: `perm-4-${agentId}`, agentId, permissionType: "process", level: "none" },
      { id: `perm-5-${agentId}`, agentId, permissionType: "browser", level: "ask" },
    ];
  }
  try {
    return await invoke("get_permissions", { agent_id: agentId });
  } catch (e) {
    console.error("get_permissions failed:", e);
    throw e;
  }
}

export async function updatePermission(agentId: string, permissionType: string, level: string): Promise<Permission> {
  if (!isTauri()) {
    return { id: `perm-${Date.now()}`, agentId, permissionType, level: level as Permission["level"] };
  }
  try {
    return await invoke("update_permission", { agent_id: agentId, permission_type: permissionType, level });
  } catch (e) {
    console.error("update_permission failed:", e);
    throw e;
  }
}

export async function getFolderWhitelist(agentId: string): Promise<FolderEntry[]> {
  if (!isTauri()) {
    return [
      { id: `folder-1-${agentId}`, agentId, path: "C:\\Users\\Documents", createdAt: new Date().toISOString() },
      { id: `folder-2-${agentId}`, agentId, path: "C:\\Projects", createdAt: new Date().toISOString() },
    ];
  }
  try {
    return await invoke("get_folder_whitelist", { agent_id: agentId });
  } catch (e) {
    console.error("get_folder_whitelist failed:", e);
    throw e;
  }
}

export async function addFolder(agentId: string, path: string): Promise<FolderEntry> {
  if (!isTauri()) {
    return { id: `folder-${Date.now()}`, agentId, path, createdAt: new Date().toISOString() };
  }
  try {
    return await invoke("add_folder_to_whitelist", { agent_id: agentId, path });
  } catch (e) {
    console.error("add_folder_to_whitelist failed:", e);
    throw e;
  }
}

export async function removeFolder(id: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke("remove_folder_from_whitelist", { id });
  } catch (e) {
    console.error("remove_folder_from_whitelist failed:", e);
    throw e;
  }
}

export async function getProgramWhitelist(agentId: string): Promise<ProgramEntry[]> {
  if (!isTauri()) {
    return [
      { id: `prog-1-${agentId}`, agentId, program: "notepad.exe", createdAt: new Date().toISOString() },
      { id: `prog-2-${agentId}`, agentId, program: "code.exe", createdAt: new Date().toISOString() },
    ];
  }
  try {
    return await invoke("get_program_whitelist", { agent_id: agentId });
  } catch (e) {
    console.error("get_program_whitelist failed:", e);
    throw e;
  }
}

export async function addProgram(agentId: string, program: string): Promise<ProgramEntry> {
  if (!isTauri()) {
    return { id: `prog-${Date.now()}`, agentId, program, createdAt: new Date().toISOString() };
  }
  try {
    return await invoke("add_program_to_whitelist", { agent_id: agentId, program });
  } catch (e) {
    console.error("add_program_to_whitelist failed:", e);
    throw e;
  }
}

export async function removeProgram(id: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke("remove_program_from_whitelist", { id });
  } catch (e) {
    console.error("remove_program_from_whitelist failed:", e);
    throw e;
  }
}

// ─── Collaboration Commands ───

export async function sendAgentMessage(fromAgent: string, toAgent: string, content: string): Promise<AgentMessage> {
  if (!isTauri()) {
    return {
      id: `amsg-${Date.now()}`,
      fromAgent,
      toAgent,
      content,
      timestamp: new Date().toISOString(),
      read: false,
    };
  }
  try {
    return await invoke("send_agent_message", { from_agent: fromAgent, to_agent: toAgent, content });
  } catch (e) {
    console.error("send_agent_message failed:", e);
    throw e;
  }
}

export async function getAgentMessages(agentId: string): Promise<AgentMessage[]> {
  if (!isTauri()) return [];
  try {
    return await invoke("get_agent_messages", { agent_id: agentId });
  } catch (e) {
    console.error("get_agent_messages failed:", e);
    throw e;
  }
}

// ─── OrgChart Commands ───

export async function getOrgChart(): Promise<OrgChartNode[]> {
  if (!isTauri()) {
    const grouped: Record<string, Agent[]> = {};
    for (const a of mockAgents.filter((a) => a.isActive)) {
      if (!grouped[a.department]) grouped[a.department] = [];
      grouped[a.department].push(a);
    }
    return mockDepartments.map((dept) => ({
      department: dept,
      agents: grouped[dept.name] || [],
    }));
  }
  try {
    return await invoke("get_org_chart");
  } catch (e) {
    console.error("get_org_chart failed:", e);
    throw e;
  }
}

export async function moveAgentDepartment(agentId: string, newDepartment: string): Promise<void> {
  if (!isTauri()) {
    const idx = mockAgents.findIndex((a) => a.id === agentId);
    if (idx !== -1) mockAgents[idx].department = newDepartment;
    return;
  }
  try {
    await invoke("move_agent_department", { agent_id: agentId, new_department: newDepartment });
  } catch (e) {
    console.error("move_agent_department failed:", e);
    throw e;
  }
}

export async function updateDepartmentCmd(deptId: string, name?: string, description?: string): Promise<Department> {
  if (!isTauri()) {
    const idx = mockDepartments.findIndex((d) => d.id === deptId);
    if (idx !== -1) {
      if (name) mockDepartments[idx].name = name;
      if (description) mockDepartments[idx].description = description;
      return mockDepartments[idx];
    }
    throw new Error("Department not found");
  }
  try {
    return await invoke("update_department", { dept_id: deptId, name, description });
  } catch (e) {
    console.error("update_department failed:", e);
    throw e;
  }
}

export async function deleteDepartment(deptId: string): Promise<boolean> {
  if (!isTauri()) {
    const idx = mockDepartments.findIndex((d) => d.id === deptId);
    if (idx !== -1) mockDepartments.splice(idx, 1);
    return true;
  }
  try {
    return await invoke("delete_department", { dept_id: deptId });
  } catch (e) {
    console.error("delete_department failed:", e);
    throw e;
  }
}

// ─── Leave Commands ───

export async function putAgentOnLeave(agentId: string, reason: string): Promise<void> {
  if (!isTauri()) {
    const idx = mockAgents.findIndex((a) => a.id === agentId);
    if (idx !== -1) {
      mockAgents[idx].onLeave = true;
      mockAgents[idx].leaveStartedAt = new Date().toISOString();
      mockAgents[idx].leaveReason = reason;
    }
    return;
  }
  try {
    await invoke("put_agent_on_leave", { agent_id: agentId, reason });
  } catch (e) {
    console.error("put_agent_on_leave failed:", e);
    throw e;
  }
}

export async function restoreAgentFromLeave(agentId: string): Promise<void> {
  if (!isTauri()) {
    const idx = mockAgents.findIndex((a) => a.id === agentId);
    if (idx !== -1) {
      mockAgents[idx].onLeave = false;
      mockAgents[idx].leaveStartedAt = undefined;
      mockAgents[idx].leaveReason = undefined;
    }
    return;
  }
  try {
    await invoke("restore_agent_from_leave", { agent_id: agentId });
  } catch (e) {
    console.error("restore_agent_from_leave failed:", e);
    throw e;
  }
}

export async function backupAgentConfig(agentId: string, reason: string): Promise<AgentBackup> {
  if (!isTauri()) {
    return {
      id: `backup-${Date.now()}`,
      agentId,
      configJson: "{}",
      reason,
      backedUpAt: new Date().toISOString(),
    };
  }
  try {
    return await invoke("backup_agent_config", { agent_id: agentId, reason });
  } catch (e) {
    console.error("backup_agent_config failed:", e);
    throw e;
  }
}

export async function getAgentBackups(agentId?: string): Promise<AgentBackup[]> {
  if (!isTauri()) return [];
  try {
    return await invoke("get_agent_backups", { agent_id: agentId || null });
  } catch (e) {
    console.error("get_agent_backups failed:", e);
    throw e;
  }
}

export async function rehireFromBackup(backupId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke("rehire_from_backup", { backup_id: backupId });
  } catch (e) {
    console.error("rehire_from_backup failed:", e);
    throw e;
  }
}

// ─── Schedule Commands ───

const mockScheduledTasks: ScheduledTask[] = [];

export async function createScheduledTask(req: CreateScheduledTaskRequest): Promise<ScheduledTask> {
  if (!isTauri()) {
    const task: ScheduledTask = {
      id: `sched-${Date.now()}`,
      title: req.title,
      description: req.description,
      cronExpression: req.cronExpression,
      assignee: req.assignee,
      priority: req.priority as ScheduledTask["priority"],
      isActive: true,
      createdAt: new Date().toISOString(),
    };
    mockScheduledTasks.push(task);
    return task;
  }
  try {
    return await invoke("create_scheduled_task", {
      request: {
        title: req.title,
        description: req.description,
        cron_expression: req.cronExpression,
        assignee: req.assignee,
        priority: req.priority,
      },
    });
  } catch (e) {
    console.error("create_scheduled_task failed:", e);
    throw e;
  }
}

export async function getScheduledTasks(activeOnly?: boolean): Promise<ScheduledTask[]> {
  if (!isTauri()) return mockScheduledTasks;
  try {
    return await invoke("get_scheduled_tasks", { active_only: activeOnly ?? null });
  } catch (e) {
    console.error("get_scheduled_tasks failed:", e);
    throw e;
  }
}

export async function updateScheduledTask(taskId: string, req: UpdateScheduledTaskRequest): Promise<ScheduledTask> {
  if (!isTauri()) {
    const idx = mockScheduledTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) {
      mockScheduledTasks[idx] = { ...mockScheduledTasks[idx], ...req } as ScheduledTask;
      return mockScheduledTasks[idx];
    }
    throw new Error("Scheduled task not found");
  }
  try {
    return await invoke("update_scheduled_task", {
      task_id: taskId,
      request: {
        title: req.title,
        description: req.description,
        cron_expression: req.cronExpression,
        assignee: req.assignee,
        priority: req.priority,
        is_active: req.isActive,
      },
    });
  } catch (e) {
    console.error("update_scheduled_task failed:", e);
    throw e;
  }
}

export async function deleteScheduledTask(taskId: string): Promise<boolean> {
  if (!isTauri()) {
    const idx = mockScheduledTasks.findIndex((t) => t.id === taskId);
    if (idx !== -1) mockScheduledTasks.splice(idx, 1);
    return true;
  }
  try {
    return await invoke("delete_scheduled_task", { task_id: taskId });
  } catch (e) {
    console.error("delete_scheduled_task failed:", e);
    throw e;
  }
}

export async function triggerScheduledTask(taskId: string): Promise<Task> {
  if (!isTauri()) {
    return {
      id: `task-${Date.now()}`,
      title: "Triggered Task",
      description: "",
      status: "pending",
      priority: "medium",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  try {
    return await invoke("trigger_scheduled_task", { task_id: taskId });
  } catch (e) {
    console.error("trigger_scheduled_task failed:", e);
    throw e;
  }
}

// ─── Program Commands ───

export async function executeProgram(
  agentId: string,
  program: string,
  args: string[],
  cwd?: string
): Promise<Record<string, unknown>> {
  if (!isTauri()) {
    return { success: true, stdout: "mock output", stderr: "", exit_code: 0 };
  }
  try {
    return await invoke("execute_tool", {
      request: {
        agent_id: agentId,
        tool_name: "program_execute",
        params: { program, args, cwd },
      },
    });
  } catch (e) {
    console.error("execute_tool failed:", e);
    throw e;
  }
}

// ─── Cost Commands ───

export async function recordCost(
  agentId: string,
  model: string,
  tokensInput: number,
  tokensOutput: number,
  costUsd: number,
  toolExecutionId?: string
): Promise<CostRecord> {
  if (!isTauri()) {
    return {
      id: `cost-${Date.now()}`,
      agentId,
      toolExecutionId,
      model,
      tokensInput,
      tokensOutput,
      costUsd,
      timestamp: new Date().toISOString(),
    };
  }
  try {
    return await invoke("record_cost", {
      agent_id: agentId,
      model,
      tokens_input: tokensInput,
      tokens_output: tokensOutput,
      cost_usd: costUsd,
      tool_execution_id: toolExecutionId || null,
    });
  } catch (e) {
    console.error("record_cost failed:", e);
    throw e;
  }
}

export async function getCostSummary(
  periodStart?: string,
  periodEnd?: string
): Promise<CostSummary> {
  if (!isTauri()) {
    return { totalCost: 0, totalTokens: 0, byAgent: [], byModel: [] };
  }
  try {
    return await invoke("get_cost_summary", {
      period_start: periodStart || null,
      period_end: periodEnd || null,
    });
  } catch (e) {
    console.error("get_cost_summary failed:", e);
    throw e;
  }
}

export async function getAgentCostHistory(
  agentId: string,
  limit?: number
): Promise<CostRecord[]> {
  if (!isTauri()) return [];
  try {
    return await invoke("get_agent_cost_history", {
      agent_id: agentId,
      limit: limit || null,
    });
  } catch (e) {
    console.error("get_agent_cost_history failed:", e);
    throw e;
  }
}

export async function getCostTrend(days?: number): Promise<DailyCost[]> {
  if (!isTauri()) return [];
  try {
    return await invoke("get_cost_trend", { days: days || null });
  } catch (e) {
    console.error("get_cost_trend failed:", e);
    throw e;
  }
}

// ─── Report Commands ───

const mockReports: Report[] = [];

export async function generateReport(
  reportType: string,
  periodStart: string,
  periodEnd: string
): Promise<Report> {
  if (!isTauri()) {
    const report: Report = {
      id: `report-${Date.now()}`,
      reportType: reportType as Report["reportType"],
      title: `${reportType.charAt(0).toUpperCase() + reportType.slice(1)} Report (${periodStart} ~ ${periodEnd})`,
      content: `# ${reportType} Report\n\n## Task Summary\n- Total: 5\n- Completed: 3\n- Failed: 1\n- In Progress: 1\n- Pending: 0\n\n## Agent Performance\n  - 김비서: 2 tasks (completed: 2, failed: 0, success rate: 100%)\n  - 박개발: 3 tasks (completed: 1, failed: 1, success rate: 33%)\n\n## Tool Executions\n- Total: 10\n- Success: 8 (80%)\n- Error: 2\n`,
      generatedAt: new Date().toISOString(),
      periodStart,
      periodEnd,
      metadata: "{}",
    };
    mockReports.unshift(report);
    return report;
  }
  try {
    return await invoke("generate_report", { report_type: reportType, period_start: periodStart, period_end: periodEnd });
  } catch (e) {
    console.error("generate_report failed:", e);
    throw e;
  }
}

export async function getReports(
  reportType?: string,
  limit?: number
): Promise<Report[]> {
  if (!isTauri()) return mockReports;
  try {
    return await invoke("get_reports", {
      report_type: reportType || null,
      limit: limit || null,
    });
  } catch (e) {
    console.error("get_reports failed:", e);
    throw e;
  }
}

export async function getReportById(reportId: string): Promise<Report> {
  if (!isTauri()) {
    const found = mockReports.find((r) => r.id === reportId);
    if (found) return found;
    throw new Error("Report not found");
  }
  try {
    return await invoke("get_report_by_id", { report_id: reportId });
  } catch (e) {
    console.error("get_report_by_id failed:", e);
    throw e;
  }
}

export async function deleteReport(reportId: string): Promise<boolean> {
  if (!isTauri()) {
    const idx = mockReports.findIndex((r) => r.id === reportId);
    if (idx !== -1) mockReports.splice(idx, 1);
    return true;
  }
  try {
    return await invoke("delete_report", { report_id: reportId });
  } catch (e) {
    console.error("delete_report failed:", e);
    throw e;
  }
}

// ─── Evaluation Commands ───

const mockEvaluations: Evaluation[] = [];

export async function evaluateAgent(
  agentId: string,
  period: string
): Promise<Evaluation> {
  if (!isTauri()) {
    const evaluation: Evaluation = {
      id: `eval-${Date.now()}`,
      agentId,
      period,
      taskSuccessRate: 75.0,
      avgCompletionTimeSecs: 1800,
      totalTasks: 8,
      completedTasks: 6,
      failedTasks: 2,
      totalCostUsd: 0.05,
      score: 72.5,
      evaluationNotes: `Mock evaluation for ${period}`,
      createdAt: new Date().toISOString(),
    };
    mockEvaluations.unshift(evaluation);
    return evaluation;
  }
  try {
    return await invoke("evaluate_agent", { agent_id: agentId, period });
  } catch (e) {
    console.error("evaluate_agent failed:", e);
    throw e;
  }
}

export async function getEvaluations(
  agentId?: string,
  limit?: number
): Promise<Evaluation[]> {
  if (!isTauri()) return mockEvaluations;
  try {
    return await invoke("get_evaluations", {
      agent_id: agentId || null,
      limit: limit || null,
    });
  } catch (e) {
    console.error("get_evaluations failed:", e);
    throw e;
  }
}

export async function getAgentPerformanceSummary(
  agentId: string
): Promise<PerformanceSummary> {
  if (!isTauri()) {
    return {
      agentId,
      taskSuccessRate: 75.0,
      avgTimeSecs: 1800,
      totalTasks: 8,
      totalCost: 0.05,
      score: 72.5,
      trend: "stable",
    };
  }
  try {
    return await invoke("get_agent_performance_summary", { agent_id: agentId });
  } catch (e) {
    console.error("get_agent_performance_summary failed:", e);
    throw e;
  }
}
