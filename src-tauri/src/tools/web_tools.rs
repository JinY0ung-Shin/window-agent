use serde_json::Value;

pub async fn web_search(_query: &str) -> Value {
    serde_json::json!({
        "success": false,
        "error": "Web search is not yet implemented"
    })
}

pub async fn web_fetch(_url: &str) -> Value {
    serde_json::json!({
        "success": false,
        "error": "Web fetch is not yet implemented"
    })
}
