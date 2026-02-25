pub mod file_tools;
pub mod process_tools;
pub mod browser_manager;
pub mod browser_tools;
pub mod web_tools;
pub mod permissions;

use serde_json::Value;

use file_tools::{file_read, file_write, FileReadParams, FileWriteParams};
use process_tools::{shell_execute, ShellExecuteParams};

pub async fn execute_tool(tool_name: &str, params: Value) -> Value {
    match tool_name {
        "file_read" => {
            let parsed: Result<FileReadParams, _> = serde_json::from_value(params);
            match parsed {
                Ok(p) => serde_json::to_value(file_read(&p)).unwrap_or(Value::Null),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Invalid params for file_read: {}", e)
                }),
            }
        }
        "file_write" => {
            let parsed: Result<FileWriteParams, _> = serde_json::from_value(params);
            match parsed {
                Ok(p) => serde_json::to_value(file_write(&p)).unwrap_or(Value::Null),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Invalid params for file_write: {}", e)
                }),
            }
        }
        "shell_execute" => {
            let parsed: Result<ShellExecuteParams, _> = serde_json::from_value(params);
            match parsed {
                Ok(p) => serde_json::to_value(shell_execute(&p)).unwrap_or(Value::Null),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Invalid params for shell_execute: {}", e)
                }),
            }
        }
        "browser_navigate" => {
            let url = params.get("url").and_then(|v| v.as_str()).unwrap_or("");
            browser_tools::browser_navigate(url).await
        }
        "browser_screenshot" => {
            browser_tools::browser_screenshot().await
        }
        "browser_click" => {
            let selector = params.get("selector").and_then(|v| v.as_str()).unwrap_or("");
            browser_tools::browser_click(selector).await
        }
        "browser_type" => {
            let selector = params.get("selector").and_then(|v| v.as_str()).unwrap_or("");
            let text = params.get("text").and_then(|v| v.as_str()).unwrap_or("");
            browser_tools::browser_type(selector, text).await
        }
        "web_search" => {
            let query = params.get("query").and_then(|v| v.as_str()).unwrap_or("");
            web_tools::web_search(query).await
        }
        "web_fetch" => {
            let url = params.get("url").and_then(|v| v.as_str()).unwrap_or("");
            web_tools::web_fetch(url).await
        }
        _ => serde_json::json!({
            "success": false,
            "error": format!("Unknown tool: {}", tool_name)
        }),
    }
}
