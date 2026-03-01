use reqwest::Client;
use serde_json::Value;
use std::env;
use std::time::Duration;

pub struct JiraClient {
    base_url: Option<String>,
    email: Option<String>,
    api_token: Option<String>,
    client: Client,
}

impl JiraClient {
    pub fn new() -> Self {
        Self {
            base_url: env::var("JIRA_BASE_URL").ok(),
            email: env::var("JIRA_EMAIL").ok(),
            api_token: env::var("JIRA_API_TOKEN").ok(),
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
                    "error": "Jira not configured. Set JIRA_BASE_URL, JIRA_EMAIL, and JIRA_API_TOKEN environment variables."
                }));
            }
        };
        let email = match &self.email {
            Some(e) if !e.is_empty() => e.as_str(),
            _ => {
                return Err(serde_json::json!({
                    "success": false,
                    "error": "Jira email not configured. Set JIRA_EMAIL environment variable."
                }));
            }
        };
        let token = match &self.api_token {
            Some(t) if !t.is_empty() => t.as_str(),
            _ => {
                return Err(serde_json::json!({
                    "success": false,
                    "error": "Jira API token not configured. Set JIRA_API_TOKEN environment variable."
                }));
            }
        };
        Ok((base_url, email, token))
    }

    pub async fn search(&self, jql: &str) -> Value {
        let (base_url, email, token) = match self.check_config() {
            Ok(c) => (c.0.to_string(), c.1.to_string(), c.2.to_string()),
            Err(e) => return e,
        };

        if jql.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "JQL query is required"
            });
        }

        let url = format!("{}/rest/api/3/search", base_url.trim_end_matches('/'));

        match self
            .client
            .get(&url)
            .basic_auth(&email, Some(&token))
            .query(&[("jql", jql), ("maxResults", "20")])
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "total": data.get("total").unwrap_or(&Value::Null),
                    "issues": data.get("issues").unwrap_or(&Value::Array(vec![]))
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Jira response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Jira API request failed: {}", e)
            }),
        }
    }

    pub async fn get_issue(&self, issue_key: &str) -> Value {
        let (base_url, email, token) = match self.check_config() {
            Ok(c) => (c.0.to_string(), c.1.to_string(), c.2.to_string()),
            Err(e) => return e,
        };

        if issue_key.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "Issue key is required (e.g., PROJ-123)"
            });
        }

        let url = format!(
            "{}/rest/api/3/issue/{}",
            base_url.trim_end_matches('/'),
            issue_key
        );

        match self
            .client
            .get(&url)
            .basic_auth(&email, Some(&token))
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "issue": data
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Jira response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Jira API request failed: {}", e)
            }),
        }
    }

    pub async fn create_issue(
        &self,
        project_key: &str,
        summary: &str,
        description: &str,
        issue_type: &str,
    ) -> Value {
        let (base_url, email, token) = match self.check_config() {
            Ok(c) => (c.0.to_string(), c.1.to_string(), c.2.to_string()),
            Err(e) => return e,
        };

        if project_key.is_empty() || summary.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "project_key and summary are required"
            });
        }

        let url = format!("{}/rest/api/3/issue", base_url.trim_end_matches('/'));

        let body = serde_json::json!({
            "fields": {
                "project": { "key": project_key },
                "summary": summary,
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [{
                        "type": "paragraph",
                        "content": [{
                            "type": "text",
                            "text": description
                        }]
                    }]
                },
                "issuetype": { "name": issue_type }
            }
        });

        match self
            .client
            .post(&url)
            .basic_auth(&email, Some(&token))
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "issue": data
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Jira response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Jira API request failed: {}", e)
            }),
        }
    }
}
