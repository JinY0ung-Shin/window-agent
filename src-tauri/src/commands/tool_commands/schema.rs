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
            description: "지정 경로의 파일 내용을 읽습니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "write_file".into(),
            description: "지정 경로에 파일을 씁니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"content":{"type":"string","description":"파일 내용"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path","content"]}),
        },
        NativeToolDef {
            name: "list_directory".into(),
            description: "디렉토리 내 파일 목록을 조회합니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"디렉토리 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"},"recursive":{"type":"boolean","description":"하위 디렉토리 포함 여부 (기본값: false)"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "delete_file".into(),
            description: "지정 경로의 파일을 삭제합니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"삭제할 파일 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "web_search".into(),
            description: "URL의 웹 페이지 내용을 가져옵니다".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"가져올 URL"}},"required":["url"]}),
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
            description: "Type text into an input field by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the input field"},"text":{"type":"string","description":"The text to type"}},"required":["ref","text"]}),
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
        NativeToolDef {
            name: "http_request".into(),
            description: "Make HTTP requests. Use {{credential:ID}} in headers/body for authentication.".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            default_enabled: true,
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "method": {
                        "type": "string",
                        "description": "HTTP method: GET, POST, PUT, DELETE, PATCH",
                        "enum": ["GET", "POST", "PUT", "DELETE", "PATCH"]
                    },
                    "url": {
                        "type": "string",
                        "description": "Request URL"
                    },
                    "headers": {
                        "type": "object",
                        "description": "Request headers as key-value pairs"
                    },
                    "body": {
                        "type": "string",
                        "description": "Request body"
                    },
                    "timeout_secs": {
                        "type": "number",
                        "description": "Request timeout in seconds (default 30, max 120)"
                    }
                },
                "required": ["url"]
            }),
        },
    ];

    // Self-awareness tools — allow agents to inspect their own state and manage schedules.
    defs.push(NativeToolDef {
        name: "self_inspect".into(),
        description: "자신의 설정, 활성화된 도구(대화 모드 기준), 예약된 작업 등 에이전트 상태를 조회합니다".into(),
        category: "self".into(),
        default_tier: "auto".into(),
        default_enabled: true,
        parameters: serde_json::json!({"type":"object","properties":{}}),
    });

    defs.push(NativeToolDef {
        name: "manage_schedule".into(),
        description: "자신의 예약 작업(크론 잡)을 관리합니다: 조회, 생성, 수정, 삭제, 활성화/비활성화. 주의: 예약된 작업은 프롬프트 전용으로 실행되며 도구(tool) 호출은 지원되지 않습니다.".into(),
        category: "self".into(),
        default_tier: "confirm".into(),
        default_enabled: true,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list", "create", "update", "delete", "toggle"],
                    "description": "수행할 작업"
                },
                "job_id": {
                    "type": "string",
                    "description": "대상 크론 잡 ID (update/delete/toggle 시 필수)"
                },
                "name": {
                    "type": "string",
                    "description": "크론 잡 이름 (create 시 필수)"
                },
                "description": {
                    "type": "string",
                    "description": "크론 잡 설명"
                },
                "schedule_type": {
                    "type": "string",
                    "enum": ["at", "every", "cron"],
                    "description": "스케줄 유형 (create 시 필수)"
                },
                "schedule_value": {
                    "type": "string",
                    "description": "스케줄 값 (create 시 필수). at: RFC3339 타임스탬프 (예: 2026-04-01T09:00:00+09:00), every: 초 단위 정수 (최소 60, 예: 3600), cron: 5필드 cron 표현식 (예: 0 9 * * 1-5)"
                },
                "prompt": {
                    "type": "string",
                    "description": "실행 시 사용할 프롬프트 (create 시 필수)"
                },
                "enabled": {
                    "type": "boolean",
                    "description": "활성화 여부 (toggle 시 필수)"
                }
            },
            "required": ["action"]
        }),
    });

    // Orchestration tools — these are not directly executed by execute_tool;
    // they are intercepted by the frontend/orchestrator layer.
    defs.push(NativeToolDef {
        name: "delegate".into(),
        description: "팀 멤버들에게 작업을 위임합니다 (팀 리더 전용)".into(),
        category: "orchestration".into(),
        default_tier: "auto".into(),
        default_enabled: false,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "agents": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "작업을 위임할 에이전트 ID 목록"
                },
                "task": {
                    "type": "string",
                    "description": "위임할 작업 설명"
                },
                "context": {
                    "type": "string",
                    "description": "추가 컨텍스트 정보 (선택)"
                }
            },
            "required": ["agents", "task"]
        }),
    });

    defs.push(NativeToolDef {
        name: "report".into(),
        description: "팀 리더에게 작업 결과를 보고합니다 (팀 멤버 전용)".into(),
        category: "orchestration".into(),
        default_tier: "auto".into(),
        default_enabled: false,
        parameters: serde_json::json!({
            "type": "object",
            "properties": {
                "summary": {
                    "type": "string",
                    "description": "작업 결과 요약"
                },
                "details": {
                    "type": "string",
                    "description": "상세 설명 (선택)"
                }
            },
            "required": ["summary"]
        }),
    });

    defs
}
