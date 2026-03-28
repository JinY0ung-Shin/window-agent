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
