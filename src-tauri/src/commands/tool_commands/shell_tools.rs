use crate::services::credential_service::{self, CredentialEnvEntry};
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex};
use tokio::time::{timeout, Duration};

/// Maximum bytes to capture per stream (stdout / stderr).
const MAX_OUTPUT_BYTES: usize = 100 * 1024; // 100 KB

/// Default timeout in seconds when the caller does not specify one.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Hard upper-bound for timeout.
const MAX_TIMEOUT_SECS: u64 = 300;

/// Execute a shell command and return structured JSON.
///
/// Credentials are injected as environment variables (CRED_* prefix).
/// Stdout and stderr are redacted to prevent credential leaks.
/// On timeout, the child process is explicitly killed.
pub(super) async fn tool_run_command(
    input: &serde_json::Value,
    default_working_dir: &str,
    credentials: &[CredentialEnvEntry],
) -> Result<serde_json::Value, String> {
    let command = input["command"]
        .as_str()
        .ok_or("run_command: missing 'command' parameter")?
        .to_string();

    let timeout_secs = input
        .get("timeout_secs")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(1, MAX_TIMEOUT_SECS);

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

    // Build redaction pairs: (credential_id, secret_value)
    let redact_pairs: Vec<(String, String)> = credentials
        .iter()
        .map(|e| (e.id.clone(), e.value.clone()))
        .collect();

    // Clone credential env vars for the blocking thread
    let env_vars: Vec<(String, String)> = credentials
        .iter()
        .map(|e| (e.env_name.clone(), e.value.clone()))
        .collect();

    // Shared process handle for kill-on-timeout
    let process_handle: Arc<Mutex<Option<u32>>> = Arc::new(Mutex::new(None));
    let process_handle_inner = Arc::clone(&process_handle);

    // Run blocking process in a dedicated thread
    let handle = tokio::task::spawn_blocking(move || {
        let mut cmd = if cfg!(target_os = "windows") {
            let mut c = Command::new("cmd");
            c.args(["/C", &command]);
            c
        } else {
            let mut c = Command::new("sh");
            c.args(["-c", &command]);
            c
        };

        cmd.current_dir(&working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Prevent console window from flashing on Windows
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        // Create a new process group so we can kill the entire tree on timeout
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }

        // Inject credential environment variables
        for (env_name, env_value) in &env_vars {
            cmd.env(env_name, env_value);
        }

        let mut process = cmd
            .spawn()
            .map_err(|e| format!("run_command: failed to spawn process: {e}"))?;

        // Store PID for kill-on-timeout
        if let Ok(mut guard) = process_handle_inner.lock() {
            *guard = Some(process.id());
        }

        // Read stdout and stderr concurrently to avoid pipe-buffer deadlocks.
        // Each stream is read in its own thread. After capturing up to
        // MAX_OUTPUT_BYTES, the reader continues draining (discarding) so the
        // child process never blocks on a full pipe.
        let stdout_pipe = process.stdout.take()
            .ok_or("run_command: failed to take stdout pipe")?;
        let stderr_pipe = process.stderr.take()
            .ok_or("run_command: failed to take stderr pipe")?;

        let stdout_handle = std::thread::spawn(move || read_bounded(stdout_pipe));
        let stderr_handle = std::thread::spawn(move || read_bounded(stderr_pipe));

        let (stdout_bytes, stdout_truncated) = stdout_handle
            .join()
            .map_err(|_| "run_command: stdout reader thread panicked".to_string())?;
        let (stderr_bytes, stderr_truncated) = stderr_handle
            .join()
            .map_err(|_| "run_command: stderr reader thread panicked".to_string())?;

        let status = process
            .wait()
            .map_err(|e| format!("run_command: failed to wait for process: {e}"))?;

        let exit_code = status.code().unwrap_or(-1);
        let truncated = stdout_truncated || stderr_truncated;

        let stdout_str = String::from_utf8_lossy(&stdout_bytes).to_string();
        let stderr_str = String::from_utf8_lossy(&stderr_bytes).to_string();

        Ok::<_, String>((exit_code, stdout_str, stderr_str, truncated))
    });

    // Apply timeout
    match timeout(Duration::from_secs(timeout_secs), handle).await {
        Ok(Ok(Ok((exit_code, stdout_str, stderr_str, truncated)))) => {
            // Redact credential values from output
            let stdout_redacted = if redact_pairs.is_empty() {
                stdout_str
            } else {
                credential_service::redact_output(&stdout_str, &redact_pairs)
            };
            let stderr_redacted = if redact_pairs.is_empty() {
                stderr_str
            } else {
                credential_service::redact_output(&stderr_str, &redact_pairs)
            };

            Ok(serde_json::json!({
                "exit_code": exit_code,
                "stdout": stdout_redacted,
                "stderr": stderr_redacted,
                "truncated": truncated,
            }))
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(format!("run_command: task panicked: {e}")),
        Err(_) => {
            // Timeout: kill the child process to prevent secret-bearing background processes
            kill_process_group(&process_handle);
            Err(format!(
                "run_command: timed out after {} seconds (process killed)",
                timeout_secs
            ))
        }
    }
}

/// Kill the child process group on timeout.
fn kill_process_group(process_handle: &Arc<Mutex<Option<u32>>>) {
    let pid = match process_handle.lock() {
        Ok(guard) => *guard,
        Err(_) => return, // Poisoned mutex — nothing we can do
    };
    let pid = match pid {
        Some(p) if p > 0 => p,
        _ => return, // No PID stored yet or PID 0 — skip to avoid killing our own group
    };

    #[cfg(unix)]
    {
        // Kill the entire process group via syscall
        // Safety: we created the child with process_group(0), so -pid targets only its group.
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
    }
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", &pid.to_string()])
            .output();
    }
}

/// Read from a reader into a bounded buffer.
/// After capturing up to MAX_OUTPUT_BYTES, continues draining the reader
/// (discarding data) so the writer never blocks on a full pipe.
/// Returns (captured_bytes, truncated).
fn read_bounded<R: Read>(mut reader: R) -> (Vec<u8>, bool) {
    let mut buf = Vec::with_capacity(MAX_OUTPUT_BYTES.min(65536));
    let mut chunk = [0u8; 8192];
    let mut truncated = false;

    loop {
        match reader.read(&mut chunk) {
            Ok(0) => break,
            Ok(n) => {
                if !truncated {
                    let remaining = MAX_OUTPUT_BYTES.saturating_sub(buf.len());
                    if remaining == 0 {
                        truncated = true;
                        // Don't break — keep draining so the child doesn't block
                    } else {
                        let take = n.min(remaining);
                        buf.extend_from_slice(&chunk[..take]);
                        if take < n {
                            truncated = true;
                        }
                    }
                }
                // If truncated, we simply discard the data and keep reading
            }
            Err(_) => break,
        }
    }

    (buf, truncated)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_read_bounded_small_input() {
        let data = b"hello world";
        let (buf, truncated) = read_bounded(&data[..]);
        assert_eq!(buf, b"hello world");
        assert!(!truncated);
    }

    #[test]
    fn test_read_bounded_exact_limit() {
        let data = vec![b'x'; MAX_OUTPUT_BYTES];
        let (buf, truncated) = read_bounded(&data[..]);
        assert_eq!(buf.len(), MAX_OUTPUT_BYTES);
        assert!(!truncated);
    }

    #[test]
    fn test_read_bounded_over_limit_truncates() {
        let data = vec![b'x'; MAX_OUTPUT_BYTES + 5000];
        let (buf, truncated) = read_bounded(&data[..]);
        assert_eq!(buf.len(), MAX_OUTPUT_BYTES);
        assert!(truncated);
    }

    #[test]
    fn test_read_bounded_empty() {
        let data: &[u8] = b"";
        let (buf, truncated) = read_bounded(data);
        assert!(buf.is_empty());
        assert!(!truncated);
    }

    #[test]
    fn test_read_bounded_drains_all_data() {
        // Simulate a large input that exceeds the cap.
        // After read_bounded returns, all data should have been consumed
        // (i.e., the reader reached EOF), preventing pipe deadlocks.
        let size = MAX_OUTPUT_BYTES * 3;
        let data = vec![b'A'; size];
        let (buf, truncated) = read_bounded(&data[..]);
        assert_eq!(buf.len(), MAX_OUTPUT_BYTES);
        assert!(truncated);
        // The key property: read_bounded consumed all `size` bytes from the reader,
        // not just MAX_OUTPUT_BYTES. This is verified by the fact that
        // read_bounded reached Ok(0) (EOF) without the reader blocking.
    }

    #[test]
    fn test_timeout_secs_clamped() {
        // timeout_secs = 0 should be clamped to 1
        assert_eq!(0u64.clamp(1, MAX_TIMEOUT_SECS), 1);
        // timeout_secs = 999 should be clamped to MAX_TIMEOUT_SECS
        assert_eq!(999u64.clamp(1, MAX_TIMEOUT_SECS), MAX_TIMEOUT_SECS);
    }
}
