use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct NativeToolDef {
    pub name: String,
    pub description: String,
    pub category: String,
    pub default_tier: String,
    pub parameters: serde_json::Value,
}

pub fn native_tool_definitions() -> Vec<NativeToolDef> {
    let mut defs = vec![
        NativeToolDef {
            name: "read_file".into(),
            description: "지정 경로의 파일 내용을 읽습니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "write_file".into(),
            description: "지정 경로에 파일을 씁니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"content":{"type":"string","description":"파일 내용"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path","content"]}),
        },
        NativeToolDef {
            name: "list_directory".into(),
            description: "디렉토리 내 파일 목록을 조회합니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"디렉토리 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"},"recursive":{"type":"boolean","description":"하위 디렉토리 포함 여부 (기본값: false)"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "delete_file".into(),
            description: "지정 경로의 파일을 삭제합니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"삭제할 파일 경로"},"scope":{"type":"string","enum":["workspace","persona","vault"],"description":"접근 범위 (기본값: workspace)","default":"workspace"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "web_search".into(),
            description: "URL의 웹 페이지 내용을 가져옵니다".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"가져올 URL"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "browser_navigate".into(),
            description: "Navigate to a URL and return a snapshot of the page".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"The URL to navigate to"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "browser_snapshot".into(),
            description: "Take a snapshot of the current page showing all interactive elements".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_click".into(),
            description: "Click an interactive element on the page by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the element to click"}},"required":["ref"]}),
        },
        NativeToolDef {
            name: "browser_type".into(),
            description: "Type text into an input field by its reference number".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"ref":{"type":"number","description":"The reference number of the input field"},"text":{"type":"string","description":"The text to type"}},"required":["ref","text"]}),
        },
        NativeToolDef {
            name: "browser_wait".into(),
            description: "Wait for a specified number of seconds then take a new snapshot".into(),
            category: "browser".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"seconds":{"type":"number","description":"Number of seconds to wait (default 2, max 10)"}}}),
        },
        NativeToolDef {
            name: "browser_back".into(),
            description: "Go back to the previous page in browser history".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "browser_close".into(),
            description: "Close the browser session for this conversation".into(),
            category: "browser".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{}}),
        },
        NativeToolDef {
            name: "http_request".into(),
            description: "Make HTTP requests. Use {{credential:ID}} in headers/body for authentication.".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
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

    // Orchestration tools — these are not directly executed by execute_tool;
    // they are intercepted by the frontend/orchestrator layer.
    defs.push(NativeToolDef {
        name: "delegate".into(),
        description: "팀 멤버들에게 작업을 위임합니다 (팀 리더 전용)".into(),
        category: "orchestration".into(),
        default_tier: "auto".into(),
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
