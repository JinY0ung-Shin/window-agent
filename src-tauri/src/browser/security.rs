use std::collections::HashSet;

use super::{SessionSecurityPolicy, SidecarResponse};

// ── URL validation and security policy ───────────────────

/// Validate URL against a session's security policy.
pub fn validate_url(url: &str, policy: &SessionSecurityPolicy) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|e| format!("invalid URL: {}", e))?;

    let scheme = parsed.scheme();
    let host = parsed.host_str().unwrap_or("");

    // Block dangerous schemes
    let blocked_schemes = [
        "file",
        "chrome",
        "about",
        "chrome-extension",
        "devtools",
        "javascript",
        "data",
    ];
    if blocked_schemes.contains(&scheme) {
        return Err(format!("blocked scheme: {}", scheme));
    }

    // Block loopback and private networks
    let is_loopback =
        host == "localhost" || host == "127.0.0.1" || host == "::1" || host == "0.0.0.0";
    let is_private = host.starts_with("10.")
        || host.starts_with("192.168.")
        || (host.starts_with("172.") && {
            if let Some(second) = host.split('.').nth(1) {
                second
                    .parse::<u8>()
                    .map(|n| (16..=31).contains(&n))
                    .unwrap_or(false)
            } else {
                false
            }
        })
        || host.ends_with(".local")
        || host.ends_with(".internal");

    if (is_loopback || is_private) && !policy.approved_domains.contains(host) {
        return Err(format!(
            "blocked: private/loopback address '{}' requires explicit approval",
            host
        ));
    }

    // Check custom blocklist
    for blocked in &policy.blocked_origins {
        if host.contains(blocked) {
            return Err(format!("blocked origin: {}", host));
        }
    }

    Ok(())
}

/// Validate the final URL after any navigation-producing action.
/// If the browser ended up on a blocked URL (via redirect/click), return error.
pub fn validate_response_url(
    resp: &SidecarResponse,
    policy: &SessionSecurityPolicy,
) -> Result<(), String> {
    if let Some(url) = &resp.url {
        if url.is_empty() || url == "about:blank" {
            return Ok(()); // Initial blank page is fine
        }
        validate_url(url, policy).map_err(|e| {
            format!("navigation landed on blocked URL: {} ({})", url, e)
        })
    } else {
        Ok(())
    }
}

impl Default for SessionSecurityPolicy {
    fn default() -> Self {
        Self {
            blocked_origins: vec![],
            approved_domains: HashSet::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_url_allows_https() {
        let policy = SessionSecurityPolicy::default();
        assert!(validate_url("https://example.com", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_allows_http() {
        let policy = SessionSecurityPolicy::default();
        assert!(validate_url("http://example.com", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_blocks_file_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("file:///etc/passwd", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked scheme"));
    }

    #[test]
    fn test_validate_url_blocks_javascript_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("javascript:alert(1)", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked scheme"));
    }

    #[test]
    fn test_validate_url_blocks_chrome_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("chrome://settings", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_data_scheme() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("data:text/html,<h1>hi</h1>", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_localhost() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://localhost:3000", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("private/loopback"));
    }

    #[test]
    fn test_validate_url_blocks_127() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://127.0.0.1:8080", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_10() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://10.0.0.1/admin", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_192() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://192.168.1.1", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_private_172() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://172.16.0.1", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_allows_172_outside_range() {
        let policy = SessionSecurityPolicy::default();
        // 172.15.x.x is NOT private range (16-31)
        assert!(validate_url("http://172.15.0.1", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_blocks_dot_local() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://myhost.local", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_blocks_dot_internal() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("http://service.internal", &policy);
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_url_approved_domain_bypasses_block() {
        let mut policy = SessionSecurityPolicy::default();
        policy.approved_domains.insert("localhost".to_string());
        assert!(validate_url("http://localhost:3000", &policy).is_ok());
    }

    #[test]
    fn test_validate_url_custom_blocklist() {
        let mut policy = SessionSecurityPolicy::default();
        policy.blocked_origins.push("evil.com".to_string());
        let result = validate_url("https://evil.com/phish", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("blocked origin"));
    }

    #[test]
    fn test_validate_url_invalid_url() {
        let policy = SessionSecurityPolicy::default();
        let result = validate_url("not a url", &policy);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("invalid URL"));
    }

    #[test]
    fn test_default_security_policy() {
        let policy = SessionSecurityPolicy::default();
        assert!(policy.blocked_origins.is_empty());
        assert!(policy.approved_domains.is_empty());
    }
}
