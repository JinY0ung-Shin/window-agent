import { invoke } from "@tauri-apps/api/core";
import type { SkillMetadata, SkillContent } from "../types";

export async function listSkills(folderName: string): Promise<SkillMetadata[]> {
  return invoke("list_skills", { folder_name: folderName });
}

export async function readSkill(folderName: string, skillName: string): Promise<SkillContent> {
  return invoke("read_skill", { folder_name: folderName, skill_name: skillName });
}

export async function readSkillResource(folderName: string, skillName: string, resourcePath: string): Promise<string> {
  return invoke("read_skill_resource", { folder_name: folderName, skill_name: skillName, resource_path: resourcePath });
}

export async function createSkill(folderName: string, skillName: string): Promise<SkillMetadata> {
  return invoke("create_skill", { folder_name: folderName, skill_name: skillName });
}

export async function updateSkill(folderName: string, skillName: string, content: string): Promise<SkillContent> {
  return invoke("update_skill", { folder_name: folderName, skill_name: skillName, content });
}

export async function deleteSkill(folderName: string, skillName: string): Promise<void> {
  return invoke("delete_skill", { folder_name: folderName, skill_name: skillName });
}

export async function updateConversationSkills(convId: string, skillNames: string[]): Promise<void> {
  return invoke("update_conversation_skills", { id: convId, skills_json: JSON.stringify(skillNames) });
}
