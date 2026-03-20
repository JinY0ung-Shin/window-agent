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
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "write_file".into(),
            description: "지정 경로에 파일을 씁니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"파일 경로"},"content":{"type":"string","description":"파일 내용"}},"required":["path","content"]}),
        },
        NativeToolDef {
            name: "list_directory".into(),
            description: "디렉토리 내 파일 목록을 조회합니다".into(),
            category: "file".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"디렉토리 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "delete_file".into(),
            description: "지정 경로의 파일을 삭제합니다".into(),
            category: "file".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"path":{"type":"string","description":"삭제할 파일 경로"}},"required":["path"]}),
        },
        NativeToolDef {
            name: "web_search".into(),
            description: "URL의 웹 페이지 내용을 가져옵니다".into(),
            category: "web".into(),
            default_tier: "confirm".into(),
            parameters: serde_json::json!({"type":"object","properties":{"url":{"type":"string","description":"가져올 URL"}},"required":["url"]}),
        },
        NativeToolDef {
            name: "memory_note".into(),
            description: "에이전트의 메모리 노트를 관리합니다. 중요: 새 노트를 만들기 전에 반드시 search로 관련 노트가 있는지 확인하세요. 같은 주제의 노트가 이미 있으면 create 대신 update를 사용하세요.".into(),
            category: "memory".into(),
            default_tier: "auto".into(),
            parameters: serde_json::json!({
                "type": "object",
                "properties": {
                    "action": {
                        "type": "string",
                        "enum": ["search", "read", "create", "update", "delete", "recall"],
                        "description": "수행할 작업: search(기존 노트 검색) | read(노트 조회, id 없으면 전체 목록) | create(새 노트 생성) | update(기존 노트 수정) | delete(노트 삭제) | recall(최근 노트 가져오기)"
                    },
                    "id": {
                        "type": "string",
                        "description": "노트 ID (read/update/delete 시 사용)"
                    },
                    "title": {
                        "type": "string",
                        "description": "노트 제목 (create 시 필수, update 시 선택)"
                    },
                    "content": {
                        "type": "string",
                        "description": "노트 내용 (create 시 필수, update 시 선택)"
                    },
                    "query": {
                        "type": "string",
                        "description": "검색어 (search 시 필수)"
                    },
                    "category": {
                        "type": "string",
                        "enum": ["knowledge", "decision", "conversation", "reflection"],
                        "description": "노트 분류 (기본값: knowledge)"
                    },
                    "scope": {
                        "type": "string",
                        "description": "범위: shared(공유 노트) | 미지정(개인 노트). search 시 self | shared | all"
                    },
                    "tags": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "태그 목록"
                    },
                    "related_ids": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "관련 노트 ID 목록 (create 시 WikiLink 생성)"
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0.0,
                        "maximum": 1.0,
                        "description": "신뢰도 0.0~1.0 (update 시 선택)"
                    },
                    "add_links": {
                        "type": "array",
                        "items": { "type": "string" },
                        "description": "추가할 관련 노트 ID (update 시 선택)"
                    },
                    "limit": {
                        "type": "integer",
                        "description": "결과 수 제한 (search/recall 시 선택)"
                    }
                },
                "required": ["action"]
            }),
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
