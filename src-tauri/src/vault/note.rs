use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Frontmatter fields for a vault note.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Frontmatter {
    pub id: String,
    pub agent: String,
    #[serde(rename = "type")]
    pub note_type: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "default_confidence")]
    pub confidence: f64,
    pub created: String,
    pub updated: String,
    #[serde(default)]
    pub revision: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub aliases: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_edited_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_conversation: Option<String>,
}

fn default_confidence() -> f64 {
    0.5
}

/// Parse YAML frontmatter from markdown content.
///
/// Expects content in the form:
/// ```text
/// ---
/// key: value
/// ---
/// body text
/// ```
pub fn parse_frontmatter(content: &str) -> Result<(Frontmatter, String), String> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Err("Missing frontmatter delimiter".to_string());
    }

    // Find the closing ---
    let after_open = &trimmed[3..];
    let close_pos = after_open
        .find("\n---")
        .ok_or_else(|| "Missing closing frontmatter delimiter".to_string())?;

    let yaml_str = &after_open[..close_pos];
    let body_start = close_pos + 4; // skip "\n---"
    let body = if body_start < after_open.len() {
        // Skip the newline after closing ---
        let rest = &after_open[body_start..];
        if let Some(stripped) = rest.strip_prefix("\r\n") {
            stripped.to_string()
        } else if let Some(stripped) = rest.strip_prefix('\n') {
            stripped.to_string()
        } else {
            rest.to_string()
        }
    } else {
        String::new()
    };

    let frontmatter: Frontmatter =
        serde_yaml::from_str(yaml_str).map_err(|e| format!("Failed to parse frontmatter: {e}"))?;

    Ok((frontmatter, body))
}

/// Serialize frontmatter and body back into markdown note content.
pub fn serialize_note(frontmatter: &Frontmatter, body: &str) -> String {
    let yaml =
        serde_yaml::to_string(frontmatter).unwrap_or_else(|_| "# serialization error\n".into());
    // serde_yaml produces a trailing newline, so yaml already ends with \n
    format!("---\n{yaml}---\n{body}")
}

/// Compute a content revision hash: first 8 hex chars of SHA-256.
pub fn compute_revision(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    let result = hasher.finalize();
    hex::encode(&result[..4]) // 4 bytes = 8 hex chars
}

/// Convert a note title to a filesystem-safe filename (without extension).
///
/// Rules:
/// - Replace `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|` with `-`
/// - Collapse consecutive `-` into one
/// - Remove leading/trailing `-` and whitespace
/// - Truncate to 200 characters
/// - If empty after sanitization, use "untitled"
pub fn sanitize_title_to_filename(title: &str) -> String {
    let mut result = String::with_capacity(title.len());
    for ch in title.chars() {
        match ch {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => {
                result.push('-');
            }
            c if c.is_control() => {
                result.push('-');
            }
            c => {
                result.push(c);
            }
        }
    }

    // Collapse consecutive dashes
    let mut collapsed = String::with_capacity(result.len());
    let mut prev_dash = false;
    for ch in result.chars() {
        if ch == '-' {
            if !prev_dash {
                collapsed.push('-');
            }
            prev_dash = true;
        } else {
            collapsed.push(ch);
            prev_dash = false;
        }
    }

    let trimmed = collapsed.trim().trim_matches('-').to_string();

    // Truncate to 200 chars (by char boundary)
    let truncated = if trimmed.chars().count() > 200 {
        trimmed.chars().take(200).collect::<String>()
    } else {
        trimmed
    };

    if truncated.is_empty() {
        "untitled".to_string()
    } else {
        truncated
    }
}

// We use hex encoding for the SHA-256 hash; bring it as a local helper
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frontmatter_basic() {
        let content = r#"---
id: "abc-123"
agent: "manager"
type: "knowledge"
tags: ["rust", "test"]
confidence: 0.9
created: "2026-03-17T14:00:00+09:00"
updated: "2026-03-17T14:00:00+09:00"
revision: "deadbeef"
---
# Hello World

This is the body.
"#;
        let (fm, body) = parse_frontmatter(content).unwrap();
        assert_eq!(fm.id, "abc-123");
        assert_eq!(fm.agent, "manager");
        assert_eq!(fm.note_type, "knowledge");
        assert_eq!(fm.tags, vec!["rust", "test"]);
        assert!((fm.confidence - 0.9).abs() < f64::EPSILON);
        assert!(body.starts_with("# Hello World"));
    }

    #[test]
    fn test_parse_frontmatter_missing_delimiters() {
        assert!(parse_frontmatter("no frontmatter").is_err());
        assert!(parse_frontmatter("---\nid: x\n").is_err());
    }

    #[test]
    fn test_serialize_roundtrip() {
        let fm = Frontmatter {
            id: "test-id".into(),
            agent: "agent1".into(),
            note_type: "knowledge".into(),
            tags: vec!["tag1".into()],
            confidence: 0.8,
            created: "2026-01-01T00:00:00Z".into(),
            updated: "2026-01-01T00:00:00Z".into(),
            revision: "abcd1234".into(),
            source: None,
            aliases: vec![],
            legacy_id: None,
            scope: None,
            last_edited_by: None,
            source_conversation: None,
        };
        let body = "# Title\n\nSome content.\n";
        let serialized = serialize_note(&fm, body);
        let (fm2, body2) = parse_frontmatter(&serialized).unwrap();
        assert_eq!(fm2.id, "test-id");
        assert_eq!(body2.trim(), body.trim());
    }

    #[test]
    fn test_compute_revision() {
        let rev = compute_revision("hello world");
        assert_eq!(rev.len(), 8);
        // Deterministic
        assert_eq!(rev, compute_revision("hello world"));
        // Different content → different revision
        assert_ne!(rev, compute_revision("hello world!"));
    }

    #[test]
    fn test_sanitize_title() {
        assert_eq!(sanitize_title_to_filename("Hello World"), "Hello World");
        assert_eq!(
            sanitize_title_to_filename("foo/bar\\baz:qux"),
            "foo-bar-baz-qux"
        );
        assert_eq!(sanitize_title_to_filename("///"), "untitled");
        assert_eq!(sanitize_title_to_filename(""), "untitled");
        // Long title truncation
        let long_title = "a".repeat(300);
        assert_eq!(sanitize_title_to_filename(&long_title).len(), 200);
    }
}
