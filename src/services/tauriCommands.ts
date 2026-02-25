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
  } catch {
    return mockAgents;
  }
}

export async function getTasks(): Promise<Task[]> {
  if (!isTauri()) return mockTasks;
  try {
    return await invoke("get_all_tasks");
  } catch {
    return mockTasks;
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
    const b: BackendAgent = await invoke("hire_agent", { request });
    return toAgent(b);
  } catch {
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
    return newAgent;
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
    return await invoke("fire_agent", { agentId });
  } catch {
    return false;
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
    const b: BackendAgent = await invoke("update_agent", { agentId, request });
    return toAgent(b);
  } catch (e) {
    throw e;
  }
}

export async function getDepartments(): Promise<Department[]> {
  if (!isTauri()) return mockDepartments;
  try {
    return await invoke("get_departments");
  } catch {
    return mockDepartments;
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
  } catch {
    return { id: `dept-${Date.now()}`, name, description, createdAt: new Date().toISOString() };
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
    return await invoke("create_task", { request });
  } catch {
    const task: Task = {
      id: `task-${Date.now()}`,
      ...request,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return task;
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
    return await invoke("update_task", { taskId, request });
  } catch (e) {
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
    return await invoke("delete_task", { taskId });
  } catch {
    return false;
  }
}

export async function getAllTasks(): Promise<Task[]> {
  if (!isTauri()) return mockTasks;
  try {
    return await invoke("get_all_tasks");
  } catch {
    return mockTasks;
  }
}

export async function getTasksByStatus(status: string): Promise<Task[]> {
  if (!isTauri()) return mockTasks.filter((t) => t.status === status);
  try {
    return await invoke("get_tasks_by_status", { status });
  } catch {
    return mockTasks.filter((t) => t.status === status);
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
    return await invoke("update_task_status", { taskId, status });
  } catch (e) {
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
    return await invoke("get_permissions", { agentId });
  } catch {
    return [];
  }
}

export async function updatePermission(agentId: string, permissionType: string, level: string): Promise<Permission> {
  if (!isTauri()) {
    return { id: `perm-${Date.now()}`, agentId, permissionType, level: level as Permission["level"] };
  }
  try {
    return await invoke("update_permission", { agentId, permissionType, level });
  } catch {
    return { id: `perm-${Date.now()}`, agentId, permissionType, level: level as Permission["level"] };
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
    return await invoke("get_folder_whitelist", { agentId });
  } catch {
    return [];
  }
}

export async function addFolder(agentId: string, path: string): Promise<FolderEntry> {
  if (!isTauri()) {
    return { id: `folder-${Date.now()}`, agentId, path, createdAt: new Date().toISOString() };
  }
  try {
    return await invoke("add_folder", { agentId, path });
  } catch {
    return { id: `folder-${Date.now()}`, agentId, path, createdAt: new Date().toISOString() };
  }
}

export async function removeFolder(id: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke("remove_folder", { id });
  } catch {
    return false;
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
    return await invoke("get_program_whitelist", { agentId });
  } catch {
    return [];
  }
}

export async function addProgram(agentId: string, program: string): Promise<ProgramEntry> {
  if (!isTauri()) {
    return { id: `prog-${Date.now()}`, agentId, program, createdAt: new Date().toISOString() };
  }
  try {
    return await invoke("add_program", { agentId, program });
  } catch {
    return { id: `prog-${Date.now()}`, agentId, program, createdAt: new Date().toISOString() };
  }
}

export async function removeProgram(id: string): Promise<boolean> {
  if (!isTauri()) return true;
  try {
    return await invoke("remove_program", { id });
  } catch {
    return false;
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
    return await invoke("send_agent_message", { fromAgent, toAgent, content });
  } catch {
    return {
      id: `amsg-${Date.now()}`,
      fromAgent,
      toAgent,
      content,
      timestamp: new Date().toISOString(),
      read: false,
    };
  }
}

export async function getAgentMessages(agentId: string): Promise<AgentMessage[]> {
  if (!isTauri()) return [];
  try {
    return await invoke("get_agent_messages", { agentId });
  } catch {
    return [];
  }
}
