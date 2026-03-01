use reqwest::Client;
use serde_json::Value;
use std::env;
use std::time::Duration;

pub struct ConfluenceClient {
    base_url: Option<String>,
    email: Option<String>,
    api_token: Option<String>,
    client: Client,
}

impl ConfluenceClient {
    pub fn new() -> Self {
        Self {
            base_url: env::var("CONFLUENCE_BASE_URL").ok(),
            email: env::var("CONFLUENCE_EMAIL").ok(),
            api_token: env::var("CONFLUENCE_API_TOKEN").ok(),
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    fn check_config(&self) -> Result<(&str, &str, &str), Value> {
        let base_url = match &self.base_url {
            Some(u) if !u.is_empty() => u.as_str(),
            _ => {
                return Err(serde_json::json!({
                    "success": false,
                    "error": "Confluence not configured. Set CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, and CONFLUENCE_API_TOKEN environment variables."
                }));
            }
        };
        let email = match &self.email {
            Some(e) if !e.is_empty() => e.as_str(),
            _ => {
                return Err(serde_json::json!({
                    "success": false,
                    "error": "Confluence email not configured. Set CONFLUENCE_EMAIL environment variable."
                }));
            }
        };
        let token = match &self.api_token {
            Some(t) if !t.is_empty() => t.as_str(),
            _ => {
                return Err(serde_json::json!({
                    "success": false,
                    "error": "Confluence API token not configured. Set CONFLUENCE_API_TOKEN environment variable."
                }));
            }
        };
        Ok((base_url, email, token))
    }

    pub async fn search(&self, query: &str) -> Value {
        let (base_url, email, token) = match self.check_config() {
            Ok(c) => (c.0.to_string(), c.1.to_string(), c.2.to_string()),
            Err(e) => return e,
        };

        if query.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "Search query is required"
            });
        }

        let cql = format!("type=page AND text~\"{}\"", query);
        let url = format!(
            "{}/wiki/rest/api/content/search",
            base_url.trim_end_matches('/')
        );

        match self
            .client
            .get(&url)
            .basic_auth(&email, Some(&token))
            .query(&[("cql", cql.as_str()), ("limit", "20")])
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "results": data.get("results").unwrap_or(&Value::Array(vec![]))
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Confluence response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Confluence API request failed: {}", e)
            }),
        }
    }

    pub async fn get_page(&self, page_id: &str) -> Value {
        let (base_url, email, token) = match self.check_config() {
            Ok(c) => (c.0.to_string(), c.1.to_string(), c.2.to_string()),
            Err(e) => return e,
        };

        if page_id.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "Page ID is required"
            });
        }

        let url = format!(
            "{}/wiki/api/v2/pages/{}",
            base_url.trim_end_matches('/'),
            page_id
        );

        match self
            .client
            .get(&url)
            .basic_auth(&email, Some(&token))
            .query(&[("body-format", "storage")])
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "page": data
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Confluence response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Confluence API request failed: {}", e)
            }),
        }
    }
}
