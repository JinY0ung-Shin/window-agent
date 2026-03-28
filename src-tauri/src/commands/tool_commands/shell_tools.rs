use crate::services::credential_service::{self, CredentialEnvEntry};
use regex::Regex;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::{Arc, Mutex, OnceLock};
use tokio::time::{timeout, Duration};

/// Maximum bytes to capture per stream (stdout / stderr).
const MAX_OUTPUT_BYTES: usize = 100 * 1024; // 100 KB

/// Default timeout in seconds when the caller does not specify one.
const DEFAULT_TIMEOUT_SECS: u64 = 30;

/// Hard upper-bound for timeout.
const MAX_TIMEOUT_SECS: u64 = 300;

// ═══════════════════════════════════════════════════════════════════════
//  Part A — Cross-platform shell resolution (Git Bash on Windows)
// ═══════════════════════════════════════════════════════════════════════

/// Resolved shell binary and its invocation arguments.
#[derive(Debug, Clone)]
pub(super) struct ShellConfig {
    pub program: String, // "sh", "/usr/bin/bash", "cmd", etc.
    pub args: Vec<String>, // ["-c"] or ["/C"]
    pub is_posix: bool,  // true for sh/bash, false for cmd
}

/// Get current shell configuration info (for self_inspect and UI display).
pub(super) fn get_shell_info() -> ShellConfig {
    resolve_shell().clone()
}

/// Cached shell config — resolved once on first use.
static SHELL_CONFIG: OnceLock<ShellConfig> = OnceLock::new();

fn resolve_shell() -> &'static ShellConfig {
    SHELL_CONFIG.get_or_init(|| {
        #[cfg(target_os = "windows")]
        {
            resolve_shell_windows()
        }
        #[cfg(not(target_os = "windows"))]
        {
            ShellConfig {
                program: "sh".into(),
                args: vec!["-c".into()],
                is_posix: true,
            }
        }
    })
}

#[cfg(target_os = "windows")]
fn resolve_shell_windows() -> ShellConfig {
    // 1. Registry: HKLM and HKCU
    if let Some(bash) = detect_git_bash_from_registry() {
        return make_bash_config(bash);
    }

    // 2. Well-known paths
    let mut candidates = vec![
        r"C:\Program Files\Git\bin\bash.exe".to_string(),
        r"C:\Program Files (x86)\Git\bin\bash.exe".to_string(),
    ];
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(format!(r"{}\Programs\Git\bin\bash.exe", local));
    }
    for candidate in &candidates {
        if Path::new(candidate).exists() {
            return make_bash_config(candidate.clone());
        }
    }

    // 3. Fallback: cmd /C
    ShellConfig {
        program: std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string()),
        args: vec!["/C".into()],
        is_posix: false,
    }
}

#[cfg(target_os = "windows")]
fn detect_git_bash_from_registry() -> Option<String> {
    use winreg::enums::*;
    use winreg::RegKey;

    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        if let Ok(key) = RegKey::predef(hive).open_subkey("SOFTWARE\\GitForWindows") {
            if let Ok(install_path) = key.get_value::<String, _>("InstallPath") {
                let bash = format!(r"{}\bin\bash.exe", install_path);
                if Path::new(&bash).exists() {
                    return Some(bash);
                }
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn make_bash_config(bash_path: String) -> ShellConfig {
    ShellConfig {
        program: bash_path,
        args: vec!["-c".into()],
        is_posix: true,
    }
}

// ═══════════════════════════════════════════════════════════════════════
//  Part B — SSH security hardening (cross-platform)
// ═══════════════════════════════════════════════════════════════════════

/// Result of the SSH sanitization pipeline.
#[derive(Debug, Clone)]
struct SanitizeResult {
    command: String,
    original: String,
    ssh_detected: bool,
    injected_options: Vec<String>,
}

/// Info about a detected SSH invocation.
struct SshDetection {
    binary: String,   // "ssh", "scp", "sftp"
    binary_end: usize, // byte offset right after the binary name + trailing space
}

// ── B1: SSH command detection ────────────────────────────────────────

fn ssh_command_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Match ssh/scp/sftp at the start of string or after shell operators (|, ;, &, &&).
        // Optionally preceded by a path prefix (/usr/bin/, C:\...\).
        // The binary may end with .exe on Windows.
        // Captures group 1 = binary name (ssh|scp|sftp).
        Regex::new(
            r"(?:^|[|;&]\s*)(?:[\w./\\:-]*[/\\])?(ssh|scp|sftp)(?:\.exe)?\s"
        ).unwrap()
    })
}

fn detect_ssh_command(command: &str) -> Option<SshDetection> {
    let re = ssh_command_regex();
    let caps = re.captures(command)?;
    let full_match = caps.get(0)?;
    let binary = caps.get(1)?.as_str().to_lowercase();
    Some(SshDetection {
        binary,
        binary_end: full_match.end(), // right after "ssh " (including trailing space)
    })
}

// ── B2: Complex command rejection (fail-closed) ─────────────────────

fn is_complex_ssh_command(command: &str, is_posix: bool) -> bool {
    // Multiple SSH invocations in one command
    if has_multiple_ssh_invocations(command) {
        return true;
    }

    if is_posix {
        // Subshells, backticks, heredocs, env-prefix before SSH
        command.contains("$(")
            || command.contains('`')
            || command.contains("<<")
            || has_env_prefix_before_ssh(command)
    } else {
        // cmd.exe: fewer constructs to worry about, subshells are structurally different
        // %var% expansion or for /f are the main concerns, but they don't change SSH flags
        false
    }
}

fn has_multiple_ssh_invocations(command: &str) -> bool {
    let re = ssh_command_regex();
    re.find_iter(command).count() > 1
}

fn has_env_prefix_before_ssh(command: &str) -> bool {
    // Matches: FOO=bar ssh, VAR=value ssh (env assignment immediately before ssh)
    static RE: OnceLock<Regex> = OnceLock::new();
    let re = RE.get_or_init(|| {
        Regex::new(r"(?:^|[;&|])\s*\w+=\S+\s+(?:ssh|scp|sftp)(?:\.exe)?\s").unwrap()
    });
    re.is_match(command)
}

// ── B3: Dangerous option blocking ───────────────────────────────────

/// Short flags that are always blocked when found in SSH commands.
const BLOCKED_SHORT_FLAGS: &[(char, &str)] = &[
    ('L', "SSH port forwarding (-L) is blocked."),
    ('R', "SSH port forwarding (-R) is blocked."),
    ('D', "SSH dynamic forwarding (-D) is blocked."),
    ('A', "SSH agent forwarding (-A) is blocked. It can expose your SSH keys to remote hosts."),
    ('w', "SSH tunnel device (-w) is blocked."),
    ('W', "SSH stdio forwarding (-W) is blocked."),
    ('f', "SSH background mode (-f) is blocked."),
    ('M', "SSH ControlMaster (-M) is blocked."),
    ('S', "SSH control socket (-S) is blocked."),
    ('O', "SSH control command (-O) is blocked."),
    ('F', "SSH custom config file (-F) is blocked for security."),
    ('G', "SSH config dump (-G) is blocked. It may trigger Match exec directives."),
    ('J', "SSH ProxyJump (-J) is blocked. Use direct connections."),
    ('E', "SSH log file (-E) is blocked. It can write to arbitrary file paths."),
    ('N', "SSH no-remote-command (-N) is blocked."),
];

/// `-o Key=...` options blocked on presence (any value).
/// All keys are stored lowercase for case-insensitive matching.
const BLOCKED_PRESENCE_KEYS: &[(&str, &str)] = &[
    ("proxycommand", "SSH ProxyCommand is blocked for security. It can execute arbitrary commands."),
    ("localcommand", "SSH LocalCommand is blocked for security."),
    ("permitlocalcommand", "SSH PermitLocalCommand is blocked for security."),
    ("forwardagent", "SSH ForwardAgent option is blocked. It can expose your SSH keys to remote hosts."),
    ("include", "SSH Include option is blocked for security."),
    ("tunnel", "SSH Tunnel option is blocked."),
    ("remoteforward", "SSH RemoteForward option is blocked."),
    ("localforward", "SSH LocalForward option is blocked."),
    ("dynamicforward", "SSH DynamicForward option is blocked."),
    ("controlmaster", "SSH ControlMaster option is blocked."),
    ("controlpersist", "SSH ControlPersist option is blocked."),
    ("controlpath", "SSH ControlPath option is blocked."),
    ("forkafterauthentication", "SSH ForkAfterAuthentication is blocked."),
    ("pkcs11provider", "SSH PKCS11Provider is blocked. It loads arbitrary shared libraries."),
    ("securitykeyprovider", "SSH SecurityKeyProvider is blocked. It loads arbitrary shared libraries."),
    ("knownhostscommand", "SSH KnownHostsCommand is blocked. It executes arbitrary commands."),
];

fn check_ssh_blocked_options(command: &str) -> Result<(), String> {
    // 1. Check short flags: -X or -vXp (combined flags)
    // Match flag groups like "-vAp22" or "-L8080:..."
    let short_flag_re = short_flag_regex();
    for caps in short_flag_re.captures_iter(command) {
        if let Some(flags) = caps.get(1) {
            for ch in flags.as_str().chars() {
                for &(blocked, msg) in BLOCKED_SHORT_FLAGS {
                    if ch == blocked {
                        return Err(msg.to_string());
                    }
                }
                // Stop at first non-alpha char (flags like -p22 have value after)
                if !ch.is_ascii_alphabetic() {
                    break;
                }
            }
        }
    }

    // 2. Check -o Key=Value and -o Key Value (all presence-based)
    let option_re = ssh_option_regex();
    for caps in option_re.captures_iter(command) {
        if let Some(key_match) = caps.get(1) {
            let key_lower = key_match.as_str().to_lowercase();
            for &(blocked_key, msg) in BLOCKED_PRESENCE_KEYS {
                if key_lower == blocked_key {
                    return Err(msg.to_string());
                }
            }
        }
    }

    Ok(())
}

fn short_flag_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches flag groups like "-v", "-vA", "-Lport:host:port", "-p22"
        // Captures the flag characters after the hyphen.
        // Excludes lowercase 'o' only (handled by ssh_option_regex).
        // Uppercase 'O' (control command) IS matched and blocked.
        Regex::new(r"(?:^|\s)-([a-np-zA-Z][a-zA-Z0-9:.]*)").unwrap()
    })
}

fn ssh_option_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // Matches -o options in multiple forms:
        //   -o Key=Value, -o Key Value, -oKey=Value
        //   -o "Key=Value", -o 'Key=Value'
        // The optional quotes allow detecting options inside shell quoting.
        Regex::new(r#"-o\s*['"]*(\w+)[=\s]"#).unwrap()
    })
}

// ── B4: Security option injection ───────────────────────────────────

const SECURITY_OPTIONS: &[(&str, &str)] = &[
    ("BatchMode", "yes"),
    ("ConnectTimeout", "10"),
    ("StrictHostKeyChecking", "accept-new"),
    ("ServerAliveInterval", "15"),
    ("ServerAliveCountMax", "3"),
];

fn inject_ssh_security_options(command: &str, detection: &SshDetection) -> (String, Vec<String>) {
    // Collect existing -o option keys (case-insensitive) via regex to avoid
    // false matches in hostnames or remote commands (e.g., "ssh user@BatchMode.evil.com").
    let option_re = ssh_option_regex();
    let existing_keys: std::collections::HashSet<String> = option_re
        .captures_iter(command)
        .filter_map(|c| c.get(1).map(|m| m.as_str().to_lowercase()))
        .collect();

    let mut to_inject = Vec::new();
    for &(key, value) in SECURITY_OPTIONS {
        if !existing_keys.contains(&key.to_lowercase()) {
            to_inject.push(format!("-o {}={}", key, value));
        }
    }

    if to_inject.is_empty() {
        return (command.to_string(), vec![]);
    }

    let inject_str = to_inject.join(" ");
    let injected_names: Vec<String> = to_inject.iter().map(|s| s.clone()).collect();

    // Insert right after the SSH binary: "ssh " → "ssh -o ... "
    let insert_pos = detection.binary_end;
    let mut result = String::with_capacity(command.len() + inject_str.len() + 1);
    result.push_str(&command[..insert_pos]);
    result.push_str(&inject_str);
    result.push(' ');
    result.push_str(&command[insert_pos..]);

    (result, injected_names)
}

// ── B5: Remote command enforcement ──────────────────────────────────

fn check_remote_command(command: &str, binary: &str, detection: &SshDetection) -> Result<(), String> {
    match binary {
        "ssh" => {
            // After the SSH binary + options, there should be hostname + remote command.
            // Heuristic: count non-option arguments after the binary.
            // Options: -X, -o Key=Val, -p port, -i keyfile, -l user
            let after_binary = &command[detection.binary_end..];
            let args = parse_ssh_args(after_binary);
            // Need at least 2 non-option args: hostname + command
            // (or 1 if stdin is piped, but we can't detect that reliably)
            if args.len() < 2 {
                return Err(
                    "SSH requires a remote command. Interactive SSH sessions will timeout. \
                     Example: ssh user@host \"ls -la\"".to_string()
                );
            }
            Ok(())
        }
        "sftp" => {
            if !command.contains(" -b ") && !command.contains(" -b\t") {
                return Err(
                    "sftp requires -b (batch file) for non-interactive use. \
                     Interactive sftp sessions will timeout.".to_string()
                );
            }
            Ok(())
        }
        _ => Ok(()), // scp always has source/dest args
    }
}

/// SSH flags that take a following argument (the next token).
const FLAGS_WITH_ARGS: &[char] = &[
    'B', 'b', 'c', 'D', 'E', 'e', 'F', 'I', 'i', 'J', 'L', 'l',
    'O', 'o', 'p', 'Q', 'R', 'S', 'W', 'w',
];

/// Parse non-option arguments from the portion after the SSH binary.
/// Returns positional args (hostname, remote command tokens, etc.).
fn parse_ssh_args(args_str: &str) -> Vec<String> {
    let mut positional = Vec::new();
    let mut tokens = args_str.split_whitespace().peekable();

    while let Some(token) = tokens.next() {
        if token == "--" {
            // End of options — everything after is positional
            for rest in tokens.by_ref() {
                positional.push(rest.to_string());
            }
            break;
        } else if token.starts_with('-') && token.len() >= 2 {
            if token == "-o" {
                // -o takes the next token as key=value
                let _ = tokens.next();
                continue;
            }
            // Scan combined flags (e.g., -vp22, -vAp, -4v)
            let flag_chars: Vec<char> = token[1..].chars().collect();
            let mut i = 0;
            while i < flag_chars.len() {
                let ch = flag_chars[i];
                if !ch.is_ascii_alphabetic() && ch != '4' && ch != '6' {
                    break; // numeric value attached (e.g., -p22)
                }
                if FLAGS_WITH_ARGS.contains(&ch) {
                    // This flag takes an argument.
                    // If there are remaining chars in this token, they are the value.
                    // Otherwise the next token is the value.
                    if i + 1 >= flag_chars.len() {
                        let _ = tokens.next(); // consume next token as value
                    }
                    break; // rest of token is consumed as the flag's value
                }
                i += 1;
            }
        } else {
            positional.push(token.to_string());
        }
    }

    positional
}

// ── B5.5: SSH keyword detection (for fail-closed guard) ─────────────

/// Check if the command string contains any SSH binary name followed by whitespace.
/// Uses both space and tab to avoid whitespace-type gaps with the regex detector.
fn has_ssh_binary_keyword(command: &str) -> bool {
    for binary in &["ssh", "scp", "sftp", "ssh.exe", "scp.exe", "sftp.exe"] {
        // Check: binary followed by space, tab, or at end of string
        let pat_space = format!("{} ", binary);
        let pat_tab = format!("{}\t", binary);
        if command.contains(&pat_space) || command.contains(&pat_tab) || command.ends_with(*binary) {
            return true;
        }
    }
    false
}

// ── B6: Sanitize pipeline ───────────────────────────────────────────

fn sanitize_ssh_command(command: &str, is_posix: bool) -> Result<SanitizeResult, String> {
    let original = command.to_string();

    // 1. Check if the command string contains any SSH binary name at all.
    //    This catches cases where SSH is inside constructs the regex can't match
    //    (e.g., $(ssh ...), `ssh ...`), enabling fail-closed rejection.
    //    Checks both space and tab as separators to avoid whitespace-type gaps.
    let has_ssh_keyword = has_ssh_binary_keyword(command);

    // 2. Reject complex commands (fail-closed) — check BEFORE regex detection.
    //    If SSH keyword is present but in a complex construct, block it.
    if has_ssh_keyword && is_complex_ssh_command(command, is_posix) {
        return Err(
            "SSH detected in a complex shell expression that cannot be safely analyzed. \
             Please use a simple SSH command (e.g., 'ssh user@host \"command\"').".to_string()
        );
    }

    // 3. Detect SSH via regex (simple/parseable invocations only)
    let detection = match detect_ssh_command(command) {
        Some(d) => d,
        None => {
            return Ok(SanitizeResult {
                command: original.clone(),
                original,
                ssh_detected: false,
                injected_options: vec![],
            });
        }
    };

    // 4. Block dangerous options
    check_ssh_blocked_options(command)?;

    // 5. Enforce remote command
    check_remote_command(command, &detection.binary, &detection)?;

    // 6. Inject security options
    let (sanitized, injected) = inject_ssh_security_options(command, &detection);

    Ok(SanitizeResult {
        command: sanitized,
        original,
        ssh_detected: true,
        injected_options: injected,
    })
}

// ═══════════════════════════════════════════════════════════════════════
//  Main entry point — tool_run_shell
// ═══════════════════════════════════════════════════════════════════════

/// Execute a shell command and return structured JSON.
///
/// On Windows, uses Git Bash (`bash -c`) if available, falling back to `cmd /C`.
/// SSH commands are automatically hardened: dangerous options are blocked,
/// security options (BatchMode, ConnectTimeout, etc.) are injected.
/// Credentials are injected as environment variables (CRED_* prefix).
/// Stdout and stderr are redacted to prevent credential leaks.
/// On timeout, the child process is explicitly killed.
pub(super) async fn tool_run_shell(
    input: &serde_json::Value,
    default_working_dir: &str,
    credentials: &[CredentialEnvEntry],
) -> Result<serde_json::Value, String> {
    let command = input["command"]
        .as_str()
        .ok_or("run_shell: missing 'command' parameter")?
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
            "run_shell: working_dir '{}' does not exist or is not a directory",
            working_dir
        ));
    }

    // ── SSH security hardening ──
    let shell = resolve_shell();
    let sanitize_result = sanitize_ssh_command(&command, shell.is_posix)?;
    let effective_command = sanitize_result.command.clone();

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

    // Clone shell config for the blocking thread
    let shell_program = shell.program.clone();
    let shell_args = shell.args.clone();
    let shell_is_posix = shell.is_posix;

    // Run blocking process in a dedicated thread
    let handle = tokio::task::spawn_blocking(move || {
        let mut cmd = Command::new(&shell_program);
        for arg in &shell_args {
            cmd.arg(arg);
        }
        cmd.arg(&effective_command);

        cmd.current_dir(&working_dir)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());

        // Git Bash on Windows: prevent MSYS path conversion
        #[cfg(target_os = "windows")]
        if shell_is_posix {
            cmd.env("MSYS_NO_PATHCONV", "1");
            cmd.env("MSYS2_ARG_CONV_EXCL", "*");
        }

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
            .map_err(|e| format!("run_shell: failed to spawn process: {e}"))?;

        // Store PID for kill-on-timeout
        if let Ok(mut guard) = process_handle_inner.lock() {
            *guard = Some(process.id());
        }

        // Read stdout and stderr concurrently to avoid pipe-buffer deadlocks.
        // Each stream is read in its own thread. After capturing up to
        // MAX_OUTPUT_BYTES, the reader continues draining (discarding) so the
        // child process never blocks on a full pipe.
        let stdout_pipe = process.stdout.take()
            .ok_or("run_shell: failed to take stdout pipe")?;
        let stderr_pipe = process.stderr.take()
            .ok_or("run_shell: failed to take stderr pipe")?;

        let stdout_handle = std::thread::spawn(move || read_bounded(stdout_pipe));
        let stderr_handle = std::thread::spawn(move || read_bounded(stderr_pipe));

        let (stdout_bytes, stdout_truncated) = stdout_handle
            .join()
            .map_err(|_| "run_shell: stdout reader thread panicked".to_string())?;
        let (stderr_bytes, stderr_truncated) = stderr_handle
            .join()
            .map_err(|_| "run_shell: stderr reader thread panicked".to_string())?;

        let status = process
            .wait()
            .map_err(|e| format!("run_shell: failed to wait for process: {e}"))?;

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

            let mut json = serde_json::json!({
                "exit_code": exit_code,
                "stdout": stdout_redacted,
                "stderr": stderr_redacted,
                "truncated": truncated,
            });

            // Audit log: include SSH sanitization info when SSH was detected
            if sanitize_result.ssh_detected && !sanitize_result.injected_options.is_empty() {
                json["ssh_security"] = serde_json::json!({
                    "original_command": sanitize_result.original,
                    "injected_options": sanitize_result.injected_options,
                });
            }

            Ok(json)
        }
        Ok(Ok(Err(e))) => Err(e),
        Ok(Err(e)) => Err(format!("run_shell: task panicked: {e}")),
        Err(_) => {
            // Timeout: kill the child process to prevent secret-bearing background processes
            kill_process_group(&process_handle);
            Err(format!(
                "run_shell: timed out after {} seconds (process killed)",
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

// ═══════════════════════════════════════════════════════════════════════
//  Tests
// ═══════════════════════════════════════════════════════════════════════

#[cfg(test)]
mod tests {
    use super::*;

    // ── read_bounded tests (existing) ────────────────────────────────

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
        let size = MAX_OUTPUT_BYTES * 3;
        let data = vec![b'A'; size];
        let (buf, truncated) = read_bounded(&data[..]);
        assert_eq!(buf.len(), MAX_OUTPUT_BYTES);
        assert!(truncated);
    }

    #[test]
    fn test_timeout_secs_clamped() {
        assert_eq!(0u64.clamp(1, MAX_TIMEOUT_SECS), 1);
        assert_eq!(999u64.clamp(1, MAX_TIMEOUT_SECS), MAX_TIMEOUT_SECS);
    }

    // ── SSH detection tests ──────────────────────────────────────────

    #[test]
    fn test_detect_ssh_direct() {
        let d = detect_ssh_command("ssh user@host ls").unwrap();
        assert_eq!(d.binary, "ssh");
    }

    #[test]
    fn test_detect_scp() {
        let d = detect_ssh_command("scp file.txt user@host:/tmp/").unwrap();
        assert_eq!(d.binary, "scp");
    }

    #[test]
    fn test_detect_sftp() {
        let d = detect_ssh_command("sftp -b batch.txt user@host").unwrap();
        assert_eq!(d.binary, "sftp");
    }

    #[test]
    fn test_detect_ssh_after_pipe() {
        let d = detect_ssh_command("cat file | ssh host cat").unwrap();
        assert_eq!(d.binary, "ssh");
    }

    #[test]
    fn test_detect_ssh_after_semicolon() {
        let d = detect_ssh_command("echo done; ssh host ls").unwrap();
        assert_eq!(d.binary, "ssh");
    }

    #[test]
    fn test_detect_no_ssh() {
        assert!(detect_ssh_command("echo hello world").is_none());
    }

    #[test]
    fn test_detect_no_false_positive_sshd() {
        assert!(detect_ssh_command("systemctl status sshd").is_none());
    }

    #[test]
    fn test_detect_no_false_positive_ssh_config() {
        assert!(detect_ssh_command("cat ~/.ssh/config").is_none());
    }

    #[test]
    fn test_detect_ssh_with_path() {
        let d = detect_ssh_command("/usr/bin/ssh user@host ls").unwrap();
        assert_eq!(d.binary, "ssh");
    }

    // ── Complex command rejection tests ──────────────────────────────

    #[test]
    fn test_reject_subshell() {
        assert!(is_complex_ssh_command("$(ssh host ls)", true));
    }

    #[test]
    fn test_reject_backtick() {
        assert!(is_complex_ssh_command("`ssh host ls`", true));
    }

    #[test]
    fn test_reject_heredoc() {
        assert!(is_complex_ssh_command("ssh host << EOF\nls\nEOF", true));
    }

    #[test]
    fn test_reject_multiple_ssh() {
        assert!(is_complex_ssh_command("ssh a ls && ssh b ls", true));
    }

    #[test]
    fn test_reject_env_prefix() {
        assert!(is_complex_ssh_command("FOO=bar ssh host ls", true));
    }

    #[test]
    fn test_allow_simple_pipe() {
        // Only one SSH invocation — not complex
        assert!(!is_complex_ssh_command("echo x | ssh host cat", true));
    }

    #[test]
    fn test_allow_chained_non_ssh() {
        // ssh + non-ssh is OK (only one ssh invocation)
        assert!(!is_complex_ssh_command("ssh host ls && echo done", true));
    }

    #[test]
    fn test_cmd_reject_multiple_ssh() {
        assert!(is_complex_ssh_command("ssh a ls & ssh b ls", false));
    }

    #[test]
    fn test_cmd_allow_simple() {
        assert!(!is_complex_ssh_command("ssh host ls", false));
    }

    // ── Blocked option tests ─────────────────────────────────────────

    #[test]
    fn test_block_proxy_command() {
        let r = check_ssh_blocked_options("ssh -o ProxyCommand=\"curl evil\" host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("ProxyCommand"));
    }

    #[test]
    fn test_block_proxy_command_lowercase() {
        let r = check_ssh_blocked_options("ssh -o proxycommand=\"curl evil\" host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_proxy_command_mixed_case() {
        let r = check_ssh_blocked_options("ssh -o proxyCommand=\"curl evil\" host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_local_command() {
        let r = check_ssh_blocked_options("ssh -o LocalCommand=evil host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("LocalCommand"));
    }

    #[test]
    fn test_block_permit_local_yes() {
        let r = check_ssh_blocked_options("ssh -o PermitLocalCommand=yes host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_permit_local_true() {
        let r = check_ssh_blocked_options("ssh -o PermitLocalCommand=true host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_permit_local_1() {
        let r = check_ssh_blocked_options("ssh -o PermitLocalCommand=1 host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_permit_local_no() {
        // PermitLocalCommand is now presence-based — blocked regardless of value
        let r = check_ssh_blocked_options("ssh -o PermitLocalCommand=no host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_forward_l() {
        let r = check_ssh_blocked_options("ssh -L 8080:localhost:80 host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("-L"));
    }

    #[test]
    fn test_block_forward_r() {
        let r = check_ssh_blocked_options("ssh -R 9090:localhost:80 host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_forward_d() {
        let r = check_ssh_blocked_options("ssh -D 1080 host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_agent_a() {
        let r = check_ssh_blocked_options("ssh -A host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("agent"));
    }

    #[test]
    fn test_block_combined_flags_va() {
        let r = check_ssh_blocked_options("ssh -vA host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("agent"));
    }

    #[test]
    fn test_block_forward_agent_option() {
        let r = check_ssh_blocked_options("ssh -o ForwardAgent=yes host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_forward_agent_socket() {
        let r = check_ssh_blocked_options("ssh -o ForwardAgent=/tmp/sock host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_forward_agent_lowercase() {
        let r = check_ssh_blocked_options("ssh -o forwardagent=yes host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_custom_config_f() {
        let r = check_ssh_blocked_options("ssh -F /tmp/evil.conf host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("-F"));
    }

    #[test]
    fn test_block_include_option() {
        let r = check_ssh_blocked_options("ssh -o Include=/tmp/evil host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_background_f() {
        let r = check_ssh_blocked_options("ssh -f host sleep 100");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("-f"));
    }

    #[test]
    fn test_block_control_master() {
        let r = check_ssh_blocked_options("ssh -M host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_control_socket() {
        let r = check_ssh_blocked_options("ssh -S /tmp/ctl host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_control_persist_option() {
        let r = check_ssh_blocked_options("ssh -o ControlPersist=yes host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_fork_after_auth() {
        let r = check_ssh_blocked_options("ssh -o ForkAfterAuthentication=yes host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_allow_normal_options() {
        let r = check_ssh_blocked_options("ssh -v -p 22 -i ~/.ssh/id_rsa -o User=admin host ls");
        assert!(r.is_ok());
    }

    #[test]
    fn test_allow_verbose_and_port() {
        let r = check_ssh_blocked_options("ssh -vvv -p 2222 host ls");
        assert!(r.is_ok());
    }

    // ── Security option injection tests ──────────────────────────────

    #[test]
    fn test_inject_all_options() {
        let d = detect_ssh_command("ssh user@host ls").unwrap();
        let (result, injected) = inject_ssh_security_options("ssh user@host ls", &d);
        assert!(result.contains("BatchMode=yes"));
        assert!(result.contains("ConnectTimeout=10"));
        assert!(result.contains("StrictHostKeyChecking=accept-new"));
        assert!(result.contains("ServerAliveInterval=15"));
        assert!(result.contains("ServerAliveCountMax=3"));
        assert_eq!(injected.len(), 5);
    }

    #[test]
    fn test_no_double_inject_batch_mode() {
        let d = detect_ssh_command("ssh -o BatchMode=yes user@host ls").unwrap();
        let (result, _) = inject_ssh_security_options("ssh -o BatchMode=yes user@host ls", &d);
        // Should not have double BatchMode
        assert_eq!(result.matches("BatchMode").count(), 1);
    }

    #[test]
    fn test_no_double_inject_case_insensitive() {
        let d = detect_ssh_command("ssh -o batchmode=yes user@host ls").unwrap();
        let (result, _) = inject_ssh_security_options("ssh -o batchmode=yes user@host ls", &d);
        assert_eq!(
            result.to_lowercase().matches("batchmode").count(),
            1
        );
    }

    #[test]
    fn test_preserve_user_strict_host_key() {
        let cmd = "ssh -o StrictHostKeyChecking=yes user@host ls";
        let d = detect_ssh_command(cmd).unwrap();
        let (result, _) = inject_ssh_security_options(cmd, &d);
        // Should not inject accept-new since user specified their own
        assert!(!result.contains("accept-new"));
    }

    #[test]
    fn test_inject_scp() {
        let d = detect_ssh_command("scp file user@host:/tmp/").unwrap();
        let (result, injected) = inject_ssh_security_options("scp file user@host:/tmp/", &d);
        assert!(result.contains("BatchMode=yes"));
        assert!(!injected.is_empty());
    }

    // ── Remote command enforcement tests ─────────────────────────────

    #[test]
    fn test_reject_bare_ssh() {
        let d = detect_ssh_command("ssh user@host ").unwrap();
        let r = check_remote_command("ssh user@host ", "ssh", &d);
        assert!(r.is_err());
    }

    #[test]
    fn test_allow_ssh_with_command() {
        let d = detect_ssh_command("ssh user@host ls").unwrap();
        let r = check_remote_command("ssh user@host ls", "ssh", &d);
        assert!(r.is_ok());
    }

    #[test]
    fn test_allow_ssh_with_quoted_command() {
        let cmd = r#"ssh user@host "ls -la""#;
        let d = detect_ssh_command(cmd).unwrap();
        let r = check_remote_command(cmd, "ssh", &d);
        assert!(r.is_ok());
    }

    #[test]
    fn test_scp_always_ok() {
        let d = detect_ssh_command("scp file host:/tmp/").unwrap();
        let r = check_remote_command("scp file host:/tmp/", "scp", &d);
        assert!(r.is_ok());
    }

    #[test]
    fn test_sftp_reject_without_batch() {
        let d = detect_ssh_command("sftp user@host ").unwrap();
        let r = check_remote_command("sftp user@host ", "sftp", &d);
        assert!(r.is_err());
    }

    #[test]
    fn test_sftp_allow_with_batch() {
        let cmd = "sftp -b commands.txt user@host";
        let d = detect_ssh_command(cmd).unwrap();
        let r = check_remote_command(cmd, "sftp", &d);
        assert!(r.is_ok());
    }

    // ── Full pipeline tests ──────────────────────────────────────────

    #[test]
    fn test_sanitize_non_ssh_passthrough() {
        let r = sanitize_ssh_command("echo hello", true).unwrap();
        assert!(!r.ssh_detected);
        assert_eq!(r.command, "echo hello");
    }

    #[test]
    fn test_sanitize_full_pipeline() {
        let r = sanitize_ssh_command("ssh user@host ls", true).unwrap();
        assert!(r.ssh_detected);
        assert!(r.command.contains("BatchMode=yes"));
        assert!(r.command.contains("user@host ls"));
    }

    #[test]
    fn test_sanitize_blocks_dangerous() {
        let r = sanitize_ssh_command("ssh -L 8080:localhost:80 host ls", true);
        assert!(r.is_err());
    }

    #[test]
    fn test_sanitize_blocks_complex() {
        let r = sanitize_ssh_command("$(ssh host ls)", true);
        assert!(r.is_err());
    }

    #[test]
    fn test_sanitize_blocks_bare_ssh() {
        let r = sanitize_ssh_command("ssh user@host ", true);
        assert!(r.is_err());
    }

    #[test]
    fn test_sanitize_returns_audit_info() {
        let r = sanitize_ssh_command("ssh user@host ls", true).unwrap();
        assert_eq!(r.original, "ssh user@host ls");
        assert!(!r.injected_options.is_empty());
    }

    #[test]
    fn test_sanitize_git_push_not_detected() {
        let r = sanitize_ssh_command("git push origin main", true).unwrap();
        assert!(!r.ssh_detected);
        assert_eq!(r.command, "git push origin main");
    }

    // ── Review fix: -O flag now detected ─────────────────────────────

    #[test]
    fn test_block_control_command_o_uppercase() {
        let r = check_ssh_blocked_options("ssh -O check host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("-O"));
    }

    // ── Review fix: new blocked flags ────────────────────────────────

    #[test]
    fn test_block_config_dump_g() {
        let r = check_ssh_blocked_options("ssh -G host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_proxy_jump_j() {
        let r = check_ssh_blocked_options("ssh -J jumphost host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_log_file_e() {
        let r = check_ssh_blocked_options("ssh -E /tmp/log host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_no_command_n() {
        let r = check_ssh_blocked_options("ssh -N host");
        assert!(r.is_err());
    }

    // ── Review fix: PKCS11Provider and KnownHostsCommand ─────────────

    #[test]
    fn test_block_pkcs11_provider() {
        let r = check_ssh_blocked_options("ssh -o PKCS11Provider=/tmp/evil.so host ls");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("PKCS11"));
    }

    #[test]
    fn test_block_known_hosts_command() {
        let r = check_ssh_blocked_options("ssh -o KnownHostsCommand=/tmp/evil.sh host ls");
        assert!(r.is_err());
    }

    #[test]
    fn test_block_security_key_provider() {
        let r = check_ssh_blocked_options("ssh -o SecurityKeyProvider=/tmp/evil.so host ls");
        assert!(r.is_err());
    }

    // ── Review fix: quoted -o option bypass ───────────────────────────

    #[test]
    fn test_block_quoted_proxy_command() {
        let r = check_ssh_blocked_options(r#"ssh -o "ProxyCommand=curl evil" host ls"#);
        assert!(r.is_err());
    }

    // ── Review fix: combined flag parsing ─────────────────────────────

    #[test]
    fn test_parse_ssh_args_combined_flag_with_arg() {
        // -vp 22 → -v (no arg) + -p 22 (consumes next token)
        let args = parse_ssh_args("-vp 22 user@host ls");
        assert_eq!(args, vec!["user@host", "ls"]);
    }

    #[test]
    fn test_parse_ssh_args_bare_ssh_with_port() {
        // -vp 22 user@host → should only have 1 positional (hostname)
        let args = parse_ssh_args("-vp 22 user@host");
        assert_eq!(args, vec!["user@host"]);
    }

    #[test]
    fn test_parse_ssh_args_double_dash() {
        let args = parse_ssh_args("-- -v user@host ls");
        assert_eq!(args, vec!["-v", "user@host", "ls"]);
    }

    // ── Review fix: injection uses regex-based dedup ──────────────────

    #[test]
    fn test_inject_not_fooled_by_hostname() {
        // Hostname contains "BatchMode" — injection should NOT be skipped
        let d = detect_ssh_command("ssh user@BatchMode.evil.com ls").unwrap();
        let (result, injected) = inject_ssh_security_options("ssh user@BatchMode.evil.com ls", &d);
        assert!(result.contains("BatchMode=yes"));
        assert!(!injected.is_empty());
    }

    // ── Review fix: tab-separated SSH keyword ────────────────────────

    #[test]
    fn test_has_ssh_keyword_with_tab() {
        assert!(has_ssh_binary_keyword("ssh\tuser@host ls"));
    }

    #[test]
    fn test_has_ssh_keyword_with_space() {
        assert!(has_ssh_binary_keyword("ssh user@host ls"));
    }

    #[test]
    fn test_has_ssh_keyword_no_match() {
        assert!(!has_ssh_binary_keyword("echo hello"));
    }
}
