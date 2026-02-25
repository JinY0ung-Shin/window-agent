pub mod file_tools;
pub mod process_tools;

use serde_json::Value;

use file_tools::{file_read, file_write, FileReadParams, FileWriteParams};
use process_tools::{shell_execute, ShellExecuteParams};

pub fn execute_tool(tool_name: &str, params: Value) -> Value {
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
        _ => serde_json::json!({
            "success": false,
            "error": format!("Unknown tool: {}", tool_name)
        }),
    }
}
