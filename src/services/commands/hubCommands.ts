import { invoke } from "@tauri-apps/api/core";

// ── Types ──

export interface HubAuthStatus {
  logged_in: boolean;
  user_id: string | null;
  email: string | null;
  display_name: string | null;
}

export interface HubUserInfo {
  id: string;
  email: string;
  display_name: string;
  peer_id: string | null;
}

export interface SharedAgent {
  id: string;
  user_id: string;
  display_name: string;
  name: string;
  description: string;
  original_agent_id: string | null;
  skills_count: number;
  notes_count: number;
  created_at: string;
  updated_at: string;
}

export interface SharedSkill {
  id: string;
  user_id: string;
  display_name: string;
  agent_id: string | null;
  agent_name: string | null;
  skill_name: string;
  description: string;
  body: string;
  created_at: string;
}

export interface SharedNote {
  id: string;
  user_id: string;
  display_name: string;
  agent_id: string | null;
  agent_name: string | null;
  title: string;
  note_type: string;
  tags: string[];
  body: string;
  created_at: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ── Auth commands ──

export async function hubRegister(email: string, password: string, displayName?: string): Promise<HubAuthStatus> {
  return invoke("hub_register", { email, password, display_name: displayName });
}

export async function hubLogin(email: string, password: string): Promise<HubAuthStatus> {
  return invoke("hub_login", { email, password });
}

export async function hubLogout(): Promise<void> {
  return invoke("hub_logout");
}

export async function hubGetAuthStatus(): Promise<HubAuthStatus> {
  return invoke("hub_get_auth_status");
}

export async function hubGetMe(): Promise<HubUserInfo> {
  return invoke("hub_get_me");
}

export async function hubUpdateMe(displayName?: string, peerId?: string): Promise<HubUserInfo> {
  return invoke("hub_update_me", { display_name: displayName, peer_id: peerId });
}

// ── Share commands ──

export async function hubShareAgent(name: string, description: string, originalAgentId?: string): Promise<SharedAgent> {
  return invoke("hub_share_agent", { name, description, original_agent_id: originalAgentId });
}

export interface ShareSkillItem {
  name: string;
  description: string;
  body: string;
}

export async function hubShareSkills(agentId: string | null, skills: ShareSkillItem[]): Promise<SharedSkill[]> {
  return invoke("hub_share_skills", { agent_id: agentId, skills });
}

export interface ShareNoteItem {
  title: string;
  note_type: string;
  tags: string[];
  body: string;
}

export async function hubShareNotes(agentId: string | null, notes: ShareNoteItem[]): Promise<SharedNote[]> {
  return invoke("hub_share_notes", { agent_id: agentId, notes });
}

// ── List commands ──

export async function hubListAgents(q?: string, limit?: number, offset?: number, userId?: string): Promise<PaginatedResponse<SharedAgent>> {
  return invoke("hub_list_agents", { q, user_id: userId, limit, offset });
}

export async function hubListSkills(q?: string, agentId?: string, limit?: number, offset?: number, userId?: string): Promise<PaginatedResponse<SharedSkill>> {
  return invoke("hub_list_skills", { q, agent_id: agentId, user_id: userId, limit, offset });
}

export async function hubListNotes(q?: string, agentId?: string, limit?: number, offset?: number, userId?: string): Promise<PaginatedResponse<SharedNote>> {
  return invoke("hub_list_notes", { q, agent_id: agentId, user_id: userId, limit, offset });
}

// ── Delete commands ──

export async function hubDeleteAgent(id: string): Promise<void> {
  return invoke("hub_delete_agent", { id });
}

export async function hubDeleteSkill(id: string): Promise<void> {
  return invoke("hub_delete_skill", { id });
}

export async function hubDeleteNote(id: string): Promise<void> {
  return invoke("hub_delete_note", { id });
}
