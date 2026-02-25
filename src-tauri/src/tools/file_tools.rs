use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct FileReadParams {
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileWriteParams {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileToolResult {
    pub success: bool,
    pub content: Option<String>,
    pub error: Option<String>,
}

pub fn file_read(params: &FileReadParams) -> FileToolResult {
    let path = Path::new(&params.path);
    if !path.exists() {
        return FileToolResult {
            success: false,
            content: None,
            error: Some(format!("File not found: {}", params.path)),
        };
    }
    match fs::read_to_string(path) {
        Ok(content) => FileToolResult {
            success: true,
            content: Some(content),
            error: None,
        },
        Err(e) => FileToolResult {
            success: false,
            content: None,
            error: Some(format!("Failed to read file: {}", e)),
        },
    }
}

pub fn file_write(params: &FileWriteParams) -> FileToolResult {
    let path = Path::new(&params.path);
    // Create parent dirs if needed
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            if let Err(e) = fs::create_dir_all(parent) {
                return FileToolResult {
                    success: false,
                    content: None,
                    error: Some(format!("Failed to create directories: {}", e)),
                };
            }
        }
    }
    match fs::write(path, &params.content) {
        Ok(_) => FileToolResult {
            success: true,
            content: Some(format!("Written {} bytes to {}", params.content.len(), params.path)),
            error: None,
        },
        Err(e) => FileToolResult {
            success: false,
            content: None,
            error: Some(format!("Failed to write file: {}", e)),
        },
    }
}
