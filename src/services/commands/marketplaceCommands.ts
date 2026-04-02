import { invoke } from "@tauri-apps/api/core";

export interface MarketplacePluginInfo {
  name: string;
  description: string;
  category: string | null;
  author: string | null;
  version: string | null;
  homepage: string | null;
  keywords: string[];
  repo_url: string;
  git_ref: string;
  subpath: string;
  source_type: string;
}

export interface RemoteSkillInfo {
  name: string;
  description: string;
  path: string;
}

export interface InstallResult {
  installed: string[];
  skipped: string[];
  errors: string[];
}

export async function marketplaceFetchPlugins(githubUrl: string): Promise<MarketplacePluginInfo[]> {
  return invoke("marketplace_fetch_plugins", { github_url: githubUrl });
}

export async function marketplaceFetchPluginSkills(
  repoUrl: string,
  gitRef: string,
  subpath: string,
): Promise<RemoteSkillInfo[]> {
  return invoke("marketplace_fetch_plugin_skills", { repo_url: repoUrl, git_ref: gitRef, subpath });
}

export async function marketplaceInstallSkills(
  folderName: string,
  repoUrl: string,
  gitRef: string,
  skills: RemoteSkillInfo[],
): Promise<InstallResult> {
  return invoke("marketplace_install_skills", { folder_name: folderName, repo_url: repoUrl, git_ref: gitRef, skills });
}

// ── Local Claude Code plugin commands ──

export interface LocalPluginInfo {
  name: string;
  marketplace: string;
  version: string;
  install_path: string;
  skill_count: number;
}

export async function localCcPluginsList(): Promise<LocalPluginInfo[]> {
  return invoke("local_cc_plugins_list");
}

export async function localCcPluginSkills(installPath: string): Promise<RemoteSkillInfo[]> {
  return invoke("local_cc_plugin_skills", { install_path: installPath });
}

export async function localCcInstallSkills(
  folderName: string,
  skills: RemoteSkillInfo[],
): Promise<InstallResult> {
  return invoke("local_cc_install_skills", { folder_name: folderName, skills });
}

// ── Skill matrix commands ──

export interface AgentBrief {
  id: string;
  name: string;
  folder_name: string;
}

export interface SkillMatrix {
  agents: AgentBrief[];
  matrix: Record<string, string[]>; // skill_name → folder_names that have it
}

export interface SkillAssignment {
  skill_name: string;
  source_path: string;
  add_to: string[];
  remove_from: string[];
}

export interface BatchResult {
  installed: string[];
  removed: string[];
  errors: string[];
}

export async function skillMatrix(skillNames: string[]): Promise<SkillMatrix> {
  return invoke("skill_matrix", { skill_names: skillNames });
}

export async function skillMatrixApply(assignments: SkillAssignment[]): Promise<BatchResult> {
  return invoke("skill_matrix_apply", { assignments });
}
