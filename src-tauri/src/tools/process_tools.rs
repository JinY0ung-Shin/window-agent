use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellExecuteParams {
    pub command: String,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ShellExecuteResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProgramExecuteParams {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProgramExecuteResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

pub fn program_execute(params: &ProgramExecuteParams) -> ProgramExecuteResult {
    let mut cmd = Command::new(&params.program);
    cmd.args(&params.args);
    if let Some(ref dir) = params.cwd {
        cmd.current_dir(dir);
    }

    match cmd.output() {
        Ok(output) => ProgramExecuteResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            error: None,
        },
        Err(e) => ProgramExecuteResult {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            error: Some(format!("Failed to execute program: {}", e)),
        },
    }
}

pub fn shell_execute(params: &ShellExecuteParams) -> ShellExecuteResult {
    let mut cmd = if cfg!(target_os = "windows") {
        let mut c = Command::new("cmd");
        c.args(["/C", &params.command]);
        c
    } else {
        let mut c = Command::new("sh");
        c.args(["-c", &params.command]);
        c
    };

    if let Some(ref cwd) = params.cwd {
        cmd.current_dir(cwd);
    }

    match cmd.output() {
        Ok(output) => ShellExecuteResult {
            success: output.status.success(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            exit_code: output.status.code(),
            error: None,
        },
        Err(e) => ShellExecuteResult {
            success: false,
            stdout: String::new(),
            stderr: String::new(),
            exit_code: None,
            error: Some(format!("Failed to execute command: {}", e)),
        },
    }
}
