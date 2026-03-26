use std::io::Read;
use std::path::Path;
use std::process::Command;
use tokio::time::{timeout, Duration};

/// Maximum bytes to capture per stream (stdout / stderr).
const MAX_OUTPUT_BYTES: usize = 100 * 1024; // 100 KB

/// Default timeout in seconds when the caller does not specify one.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Hard upper-bound for timeout.
const MAX_TIMEOUT_SECS: u64 = 300;

/// Execute a shell command and return structured JSON.
///
/// Uses `std::process::Command` inside `spawn_blocking` so the tokio runtime
/// is not blocked.  Stdout and stderr are captured via piped handles with
/// bounded reads to prevent memory exhaustion.
pub(super) async fn tool_run_command(
    input: &serde_json::Value,
    default_working_dir: &str,
) -> Result<serde_json::Value, String> {
    let command = input["command"]
        .as_str()
        .ok_or("run_command: missing 'command' parameter")?
        .to_string();

    let timeout_secs = input
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .min(MAX_TIMEOUT_SECS);

    let working_dir = input
        .get("working_dir")
        .and_then(|v| v.as_str())
        .unwrap_or(default_working_dir)
        .to_string();

    // Validate working directory exists
    if !Path::new(&working_dir).is_dir() {
        return Err(format!(
            "run_command: working_dir '{}' does not exist or is not a directory",
            working_dir
        ));
    }

    // Run blocking process in a dedicated thread
    let handle = tokio::task::spawn_blocking(move || {
        let mut child = if cfg!(target_os = "windows") {
            let mut cmd = Command::new("cmd");
            cmd.args(["/C", &command]);
            cmd
        } else {
            let mut cmd = Command::new("sh");
            cmd.args(["-c", &command]);
            cmd
        };

        child
            .current_dir(&working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        let mut process = child
            .spawn()
            .map_err(|e| format!("run_command: failed to spawn process: {e}"))?;

        // Read stdout bounded
        let (stdout_bytes, stdout_truncated) = {
            let pipe = process.stdout.take().unwrap();
            read_bounded(pipe)
        };

        // Read stderr bounded
        let (stderr_bytes, stderr_truncated) = {
            let pipe = process.stderr.take().unwrap();
            read_bounded(pipe)
        };

        let status = process
            .wait()
            .map_err(|e| format!("run_command: failed to wait for process: {e}"))?;

        let exit_code = status.code().unwrap_or(-1);
        let truncated = stdout_truncated || stderr_truncated;

        Ok::<_, String>(serde_json::json!({
            "exit_code": exit_code,
            "stdout": String::from_utf8_lossy(&stdout_bytes),
            "stderr": String::from_utf8_lossy(&stderr_bytes),
            "truncated": truncated,
        }))
    });

    // Apply timeout
    match timeout(Duration::from_secs(timeout_secs), handle).await {
        Ok(Ok(result)) => result,
        Ok(Err(e)) => Err(format!("run_command: task panicked: {e}")),
        Err(_) => Err(format!(
            "run_command: timed out after {} seconds",
            timeout_secs
        )),
    }
}

/// Read from a reader into a bounded buffer.
/// Returns (bytes, truncated).
fn read_bounded<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let mut buf = Vec::with_capacity(MAX_OUTPUT_BYTES.min(65536));
    let mut chunk = [0u8; 8192];
    let mut truncated = false;

    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                let remaining = MAX_OUTPUT_BYTES.saturating_sub(buf.len());
                if remaining == 0 {
                    truncated = true;
                    break;
                }
                let take = n.min(remaining);
                buf.extend_from_slice(&chunk[..take]);
                if take < n {
                    truncated = true;
                    break;
                }
            }
            Err(_) => break,
        }
    }

    (buf, truncated)
}
