use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct NativeToolDef {
    pub name: String,
    pub description: String,
    pub category: String,
    pub default_tier: String,
    /// Whether this tool should be enabled by default in new or migrated configs.
    /// Single source of truth — both `get_default_tool_config` and
    /// `normalize_tool_config` read this field.
    pub default_enabled: bool,
    pub parameters: serde_json::Value,
}

pub fn native_tool_definitions() -> Vec<NativeToolDef> {
    let mut defs = vec![
        NativeToolDef {
            name: "read_file".into(),
            description: "Read the contents of a file at the specified path".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"File path"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"Access scope (default: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "write_file".into(),
            description: "Write content to a file at the specified path".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"File path"},"content":{"type":"string","description":"File content"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"Access scope (default: workspace)","default":"workspace"}},"required":["path","content"]}),
        },
        NativeToolDef {
            name: "list_directory".into(),
            description: "List files in a directory".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"Directory path"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"Access scope (default: workspace)","default":"workspace"},"recursive":{"type":"boolean","description":"Include subdirectories (default: false)"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "delete_file".into(),
            description: "Delete a file at the specified path".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"File path to delete"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"Access scope (default: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "web_search".into(),
            description: "Fetch the contents of a web page at the given URL".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"URL to fetch"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "browser_navigate".into(),
            description: "Navigate to a URL and return a snapshot of the page".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"The URL to navigate to"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "browser_snapshot".into(),
            description: "Take a snapshot of the current page showing all interactive elements".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_click".into(),
            description: "Click an interactive element on the page by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the element to click"}},"required":["ref"]}),
        },
        NativeToolDef {
            name: "browser_type".into(),
            description: "Type text into an input field by its reference number. For password/secret fields, use {{credential:ID}} to securely inject stored credentials.".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the input field"},"text":{"type":"string","description":"The text to type. Use {{credential:ID}} syntax for password or secret fields — the actual value is injected securely by the backend."}},"required":["ref","text"]}),
        },
        NativeToolDef {
            name: "browser_wait".into(),
            description: "Wait for a specified number of seconds then take a new snapshot".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"seconds":{"type":"number","description":"Number of seconds to wait (default 2, max 10)"}}}),
        },
        NativeToolDef {
            name: "browser_back".into(),
            description: "Go back to the previous page in browser history".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_close".into(),
            description: "Close the browser session for this conversation".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
    ];

    // System tools — allow agents to execute shell commands on the host.
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;
    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    };
    defs.push(NativeToolDef {
        name: "run_shell".into(),
        description: format!(
            "Execute a shell command and return the result. System: os={os}, arch={arch}, shell={shell}. \
             Allowed credentials are automatically injected as environment variables (CRED_* prefix). \
             [SSH SECURITY] SSH commands (ssh/scp/sftp) are automatically hardened: \
             BatchMode, ConnectTimeout, StrictHostKeyChecking, ServerAliveInterval are auto-injected. \
             Blocked SSH options: port forwarding (-L/-R/-D), agent forwarding (-A), \
             ProxyCommand, custom config (-F), background/multiplex (-f/-M/-S). \
             Complex SSH expressions (subshells, heredocs, multiple SSH calls) are rejected. \
             Always specify a remote command (e.g. ssh host \"ls -la\"). \
             Interactive programs (vi, top, etc.) cannot be used."
        ),
        category: "system".into(),
        default_tier: "confirm".into(),
        default_enabled: true,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "Shell command to execute"
                },
                "timeout_secs": {
                    "type": "number",
                    "description": "Timeout in seconds (default 30, max 300)"
                },
                "working_dir": {
                    "type": "string",
                    "description": "Working directory (default: agent workspace)"
                }
            },
            "required": ["command"]
        }),
    });

    // Self-awareness tools — allow agents to inspect their own state and manage schedules.
    defs.push(NativeToolDef {
        name: "self_inspect".into(),
        description: "Inspect the agent's own state: settings, enabled tools (conversation mode), and scheduled jobs".into(),
        category: "self".into(),
        default_tier: "auto".into(),
        default_enabled: true,
        parameters: serde_json::json!({"type":"object","properties":{}}),
    });

    defs.push(NativeToolDef {
        name: "manage_schedule".into(),
        description: "Manage the agent's scheduled jobs (cron): list, create, update, delete, toggle. Scheduled jobs can use the agent's tools (except browser).".into(),
        category: "self".into(),
        default_tier: "confirm".into(),
        default_enabled: true,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "update", "delete", "toggle"],
                    "description": "Action to perform"
                },
                "job_id": {
                    "type": "string",
                    "description": "Target cron job ID (required for update/delete/toggle)"
                },
                "name": {
                    "type": "string",
                    "description": "Cron job name (required for create)"
                },
                "description": {
                    "type": "string",
                    "description": "Cron job description"
                },
                "schedule_type": {
                    "type": "string",
                    "enum": ["at", "every", "cron"],
                    "description": "Schedule type (required for create)"
                },
                "schedule_value": {
                    "type": "string",
                    "description": "Schedule value (required for create). at: RFC3339 timestamp (e.g. 2026-04-01T09:00:00+09:00), every: interval in seconds (min 60, e.g. 3600), cron: 5-field cron expression (e.g. 0 9 * * 1-5)"
                },
                "prompt": {
                    "type": "string",
                    "description": "Prompt to use when executing (required for create)"
                },
                "enabled": {
                    "type": "boolean",
                    "description": "Whether to enable or disable (required for toggle)"
                }
            },
            "required": ["action"]
        }),
    });

    // Orchestration tools — these are not directly executed by execute_tool;
    // they are intercepted by the frontend/orchestrator layer.
    defs.push(NativeToolDef {
        name: "delegate".into(),
        description: "Delegate tasks to team members (team leader only)".into(),
        category: "orchestration".into(),
        default_tier: "auto".into(),
        default_enabled: false,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "agents": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "List of agent IDs to delegate to"
                },
                "task": {
                    "type": "string",
                    "description": "Task description to delegate"
                },
                "context": {
                    "type": "string",
                    "description": "Additional context (optional)"
                }
            },
            "required": ["agents", "task"]
        }),
    });

    defs.push(NativeToolDef {
        name: "report".into(),
        description: "Report task results to the team leader (team member only)".into(),
        category: "orchestration".into(),
        default_tier: "auto".into(),
        default_enabled: false,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "Summary of task results"
                },
                "details": {
                    "type": "string",
                    "description": "Detailed description (optional)"
                }
            },
            "required": ["summary"]
        }),
    });

    defs
}
