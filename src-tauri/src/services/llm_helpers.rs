//! Shared helpers for backend-driven LLM completion with tool execution.
//! Used by cron_scheduler, relay/secretary, and other backend execution paths.

use crate::commands::tool_commands::native_tool_definitions;
use crate::services::actor_context::{self, ExecutionScope, ResolvedContext};

/// Build the system prompt string from a resolved context and execution scope.
pub fn build_system_prompt(resolved: &ResolvedContext, scope: &ExecutionScope) -> String {
    let mut parts = Vec::new();
    if !resolved.system_prompt.is_empty() {
        parts.push(resolved.system_prompt.clone());
    }
    if let Some(ref agents_sec) = resolved.registered_agents_section {
        parts.push(agents_sec.clone());
    }
    if let Some(ref mem) = resolved.consolidated_memory {
        parts.push(format!("[CONSOLIDATED MEMORY]\n{mem}"));
    }
    if let Some(ref tools_sec) = resolved.tools_section {
        parts.push(tools_sec.clone());
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
