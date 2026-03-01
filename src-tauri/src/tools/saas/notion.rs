use reqwest::Client;
use serde_json::Value;
use std::env;
use std::time::Duration;

pub struct NotionClient {
    api_key: Option<String>,
    client: Client,
}

impl NotionClient {
    pub fn new() -> Self {
        Self {
            api_key: env::var("NOTION_API_KEY").ok(),
            client: Client::builder()
                .timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
        }
    }

    fn check_api_key(&self) -> Result<&str, Value> {
        match &self.api_key {
            Some(key) if !key.is_empty() => Ok(key.as_str()),
            _ => Err(serde_json::json!({
                "success": false,
                "error": "Notion API key not configured. Set NOTION_API_KEY environment variable."
            })),
        }
    }

    pub async fn search(&self, query: &str) -> Value {
        let api_key = match self.check_api_key() {
            Ok(k) => k.to_string(),
            Err(e) => return e,
        };

        let body = serde_json::json!({
            "query": query,
            "page_size": 10
        });

        match self
            .client
            .post("https://api.notion.com/v1/search")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Notion-Version", "2022-06-28")
            .json(&body)
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
                    "error": format!("Failed to parse Notion response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Notion API request failed: {}", e)
            }),
        }
    }

    pub async fn get_page(&self, page_id: &str) -> Value {
        let api_key = match self.check_api_key() {
            Ok(k) => k.to_string(),
            Err(e) => return e,
        };

        if page_id.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "Page ID is required"
            });
        }

        match self
            .client
            .get(format!("https://api.notion.com/v1/pages/{}", page_id))
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Notion-Version", "2022-06-28")
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
                    "error": format!("Failed to parse Notion response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Notion API request failed: {}", e)
            }),
        }
    }

    pub async fn create_page(&self, parent_id: &str, title: &str, content: &str) -> Value {
        let api_key = match self.check_api_key() {
            Ok(k) => k.to_string(),
            Err(e) => return e,
        };

        if parent_id.is_empty() || title.is_empty() {
            return serde_json::json!({
                "success": false,
                "error": "parent_id and title are required"
            });
        }

        let body = serde_json::json!({
            "parent": { "page_id": parent_id },
            "properties": {
                "title": {
                    "title": [{
                        "text": { "content": title }
                    }]
                }
            },
            "children": [{
                "object": "block",
                "type": "paragraph",
                "paragraph": {
                    "rich_text": [{
                        "type": "text",
                        "text": { "content": content }
                    }]
                }
            }]
        });

        match self
            .client
            .post("https://api.notion.com/v1/pages")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Notion-Version", "2022-06-28")
            .json(&body)
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
                    "error": format!("Failed to parse Notion response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Notion API request failed: {}", e)
            }),
        }
    }

    pub async fn list_pages(&self, limit: usize) -> Value {
        let api_key = match self.check_api_key() {
            Ok(k) => k.to_string(),
            Err(e) => return e,
        };

        let body = serde_json::json!({
            "filter": { "property": "object", "value": "page" },
            "page_size": limit.min(100)
        });

        match self
            .client
            .post("https://api.notion.com/v1/search")
            .header("Authorization", format!("Bearer {}", api_key))
            .header("Notion-Version", "2022-06-28")
            .json(&body)
            .send()
            .await
        {
            Ok(resp) => match resp.json::<Value>().await {
                Ok(data) => serde_json::json!({
                    "success": true,
                    "pages": data.get("results").unwrap_or(&Value::Array(vec![]))
                }),
                Err(e) => serde_json::json!({
                    "success": false,
                    "error": format!("Failed to parse Notion response: {}", e)
                }),
            },
            Err(e) => serde_json::json!({
                "success": false,
                "error": format!("Notion API request failed: {}", e)
            }),
        }
    }
}
