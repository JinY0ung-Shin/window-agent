//! Centralized HTTP client factory.
//!
//! **Every** outbound HTTP client in the app MUST be created through this module.
//! This ensures proxy / no-proxy / user-agent / timeout settings are applied
//! consistently and can never be accidentally omitted.
//!
//! If you need a `reqwest::Client`, call one of:
//! - `build_http_client()`  — respects system proxy (for external APIs like OpenAI)
//! - `build_no_proxy_client()` — bypasses proxy (for internal servers like relay/hub)

use std::time::Duration;

const USER_AGENT: &str = "WindowAgent/0.18";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(60);

/// Build an HTTP client that **respects** the system proxy settings.
/// Use this for external API calls (OpenAI, GitHub, etc.).
///
/// `no_proxy` — if true, overrides the system proxy and connects directly.
///              This is the user-facing setting from the Settings UI.
pub fn build_http_client(no_proxy: bool) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DEFAULT_TIMEOUT);
    if no_proxy {
        builder = builder.no_proxy();
    }
    builder.build().unwrap_or_else(|_| reqwest::Client::new())
}

/// Build an HTTP client that **always** bypasses the system proxy.
/// Use this for internal / LAN / relay servers that should never go through
/// a corporate proxy.
pub fn build_no_proxy_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DEFAULT_TIMEOUT)
        .no_proxy()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_default_client() {
        let _client = build_http_client(false);
    }

    #[test]
    fn build_no_proxy() {
        let _client = build_http_client(true);
    }

    #[test]
    fn build_always_no_proxy() {
        let _client = build_no_proxy_client();
    }

}
