//! Shared helpers for backend-driven LLM completion with tool execution.
//! Used by cron_scheduler, relay/secretary, and other backend execution paths.

use crate::commands::tool_commands::native_tool_definitions;
use crate::services::actor_context::{self, ExecutionScope, ResolvedContext};

/// Learning mode system prompt (English — backend paths don't have i18n).
pub const LEARNING_MODE_PROMPT: &str = "\
[LEARNING MODE — Activated]\n\
You are now in 'Learning Mode'. Absorb what the user teaches you quickly and accurately, \
with the mindset of an eager student.\n\n\
Behavior Rules:\n\
1. Confirm: When the user tells you something, summarize the key point in your own words \
using the format \"From what I understand...\"\n\
2. Search First: Before saving a memory, use list_directory(scope: 'vault', path: '.', recursive: true) \
to check existing notes. If a note on the same topic exists, overwrite it; otherwise, create a new one.\n\
3. Connect: Link newly learned content to existing memories. Reference related note paths within files.\n\
4. Ask: If something is unclear or ambiguous, ask a clarifying question. Do not guess.\n\
5. Organize: Use vault categories as top-level directories: knowledge/, decision/, conversation/, reflection/. \
Create at most 3 memories per turn.\n\
6. Reference Existing Memories: When responding, cite relevant existing memories to show that \
learning is accumulating.\n\n\
How to save memories: write_file(scope: 'vault', path: '<category>/<filename>.md', content: '...')\n\
Categories: knowledge (facts/info), decision (choices made), conversation (key exchanges), reflection (insights)";

/// Build the system prompt string from a resolved context and execution scope.
pub fn build_system_prompt(resolved: &ResolvedContext, scope: &ExecutionScope) -> String {
    let mut parts = Vec::new();
    if !resolved.system_prompt.is_empty() {
        parts.push(resolved.system_prompt.clone());
    }
    if let Some(ref agents_sec) = resolved.registered_agents_section {
        parts.push(agents_sec.clone());
    }
    if resolved.learning_mode {
        parts.push(LEARNING_MODE_PROMPT.to_string());
    }
    if let Some(ref mem) = resolved.consolidated_memory {
        parts.push(format!("[CONSOLIDATED MEMORY]\n{mem}"));
    }
    if let Some(ref tools_sec) = resolved.tools_section {
        parts.push(tools_sec.clone());
    }
    if let Some(ref creds_sec) = resolved.credentials_section {
        parts.push(creds_sec.clone());
    }
    parts.push(
        actor_context::role_instruction(&scope.role)
            .unwrap_or("Complete the task below.")
            .to_string(),
    );
    parts.join("\n\n")
}

/// Build the OpenAI-compatible tools JSON array from enabled tool names.
pub fn build_tools_json(enabled_tool_names: &[String]) -> Vec<serde_json::Value> {
    let all_defs = native_tool_definitions();
    enabled_tool_names
        .iter()
        .filter_map(|name| {
            all_defs.iter().find(|d| d.name == *name).map(|def| {
                serde_json::json!({
                    "type": "function",
                    "function": {
                        "name": def.name,
                        "description": def.description,
                        "parameters": def.parameters,
                    }
                })
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::actor_context::{ExecutionRole, ExecutionScope, ExecutionTrigger, ResolvedContext};

    fn make_scope(role: ExecutionRole) -> ExecutionScope {
        ExecutionScope {
            actor_agent_id: "test-agent".into(),
            role,
            trigger: ExecutionTrigger::BackendTriggered,
        }
    }

    fn make_resolved(
        system_prompt: &str,
        agents_section: Option<&str>,
        memory: Option<&str>,
        tools_section: Option<&str>,
    ) -> ResolvedContext {
        ResolvedContext {
            system_prompt: system_prompt.into(),
            enabled_tool_names: vec![],
            model: "test-model".into(),
            temperature: None,
            thinking_enabled: false,
            thinking_budget: None,
            consolidated_memory: memory.map(|s| s.into()),
            registered_agents_section: agents_section.map(|s| s.into()),
            tools_section: tools_section.map(|s| s.into()),
            credentials_section: None,
            learning_mode: false,
        }
    }

    // ── build_system_prompt tests ──

    #[test]
    fn build_system_prompt_basic() {
        let resolved = make_resolved("You are helpful.", None, None, None);
        let scope = make_scope(ExecutionRole::CronExecution);
        let prompt = build_system_prompt(&resolved, &scope);
        assert!(prompt.contains("You are helpful."));
        assert!(prompt.contains("scheduled task"));
    }

    #[test]
    fn build_system_prompt_with_memory() {
        let resolved = make_resolved("Base prompt.", None, Some("User likes Rust."), None);
        let scope = make_scope(ExecutionRole::TeamMember);
        let prompt = build_system_prompt(&resolved, &scope);
        assert!(prompt.contains("[CONSOLIDATED MEMORY]"));
        assert!(prompt.contains("User likes Rust."));
    }

    #[test]
    fn build_system_prompt_with_agents_section() {
        let resolved = make_resolved("Base.", Some("[REGISTERED AGENTS]\nAlice, Bob"), None, None);
        let scope = make_scope(ExecutionRole::TeamLeaderSynthesis);
        let prompt = build_system_prompt(&resolved, &scope);
        assert!(prompt.contains("Alice, Bob"));
        assert!(prompt.contains("Synthesize"));
    }

    #[test]
    fn build_system_prompt_empty_system_prompt_omitted() {
        let resolved = make_resolved("", None, None, None);
        let scope = make_scope(ExecutionRole::CronExecution);
        let prompt = build_system_prompt(&resolved, &scope);
        // Should not start with \n\n (empty part is skipped)
        assert!(!prompt.starts_with("\n\n"));
    }

    #[test]
    fn build_system_prompt_all_sections() {
        let resolved = make_resolved(
            "System.",
            Some("Agents: A"),
            Some("Memory: X"),
            Some("Tools: read_file"),
        );
        let scope = make_scope(ExecutionRole::RelayResponse);
        let prompt = build_system_prompt(&resolved, &scope);
        assert!(prompt.contains("System."));
        assert!(prompt.contains("Agents: A"));
        assert!(prompt.contains("[CONSOLIDATED MEMORY]\nMemory: X"));
        assert!(prompt.contains("Tools: read_file"));
        assert!(prompt.contains("responding to a message"));
    }

    // ── build_tools_json tests ──

    #[test]
    fn build_tools_json_known_tool() {
        let tools = build_tools_json(&["read_file".to_string()]);
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["type"], "function");
        assert_eq!(tools[0]["function"]["name"], "read_file");
    }

    #[test]
    fn build_tools_json_unknown_tool_filtered() {
        let tools = build_tools_json(&["nonexistent_tool_xyz".to_string()]);
        assert!(tools.is_empty());
    }

    #[test]
    fn build_tools_json_empty_input() {
        let tools = build_tools_json(&[]);
        assert!(tools.is_empty());
    }

    #[test]
    fn build_tools_json_multiple_tools() {
        let tools = build_tools_json(&[
            "read_file".to_string(),
            "write_file".to_string(),
            "list_directory".to_string(),
        ]);
        assert_eq!(tools.len(), 3);
        let names: Vec<&str> = tools.iter().map(|t| t["function"]["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"read_file"));
        assert!(names.contains(&"write_file"));
        assert!(names.contains(&"list_directory"));
    }
}
