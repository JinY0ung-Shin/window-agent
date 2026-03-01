pub mod confluence;
pub mod jira;
pub mod notion;

use serde_json::Value;

use confluence::ConfluenceClient;
use jira::JiraClient;
use notion::NotionClient;

pub async fn execute_saas_tool(tool_name: &str, params: &Value) -> Option<Value> {
    match tool_name {
        // Notion tools
        "notion_search" => {
            let query = params
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(NotionClient::new().search(query).await)
        }
        "notion_get_page" => {
            let page_id = params
                .get("page_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(NotionClient::new().get_page(page_id).await)
        }
        "notion_create_page" => {
            let parent_id = params
                .get("parent_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let title = params
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let content = params
                .get("content")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(NotionClient::new().create_page(parent_id, title, content).await)
        }
        "notion_list_pages" => {
            let limit = params
                .get("limit")
                .and_then(|v| v.as_u64())
                .unwrap_or(10) as usize;
            Some(NotionClient::new().list_pages(limit).await)
        }

        // Jira tools
        "jira_search" => {
            let jql = params
                .get("jql")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(JiraClient::new().search(jql).await)
        }
        "jira_get_issue" => {
            let issue_key = params
                .get("issue_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(JiraClient::new().get_issue(issue_key).await)
        }
        "jira_create_issue" => {
            let project_key = params
                .get("project_key")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let summary = params
                .get("summary")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let description = params
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let issue_type = params
                .get("issue_type")
                .and_then(|v| v.as_str())
                .unwrap_or("Task");
            Some(
                JiraClient::new()
                    .create_issue(project_key, summary, description, issue_type)
                    .await,
            )
        }

        // Confluence tools
        "confluence_search" => {
            let query = params
                .get("query")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(ConfluenceClient::new().search(query).await)
        }
        "confluence_get_page" => {
            let page_id = params
                .get("page_id")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            Some(ConfluenceClient::new().get_page(page_id).await)
        }

        _ => None,
    }
}
