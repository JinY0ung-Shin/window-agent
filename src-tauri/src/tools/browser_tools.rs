use serde_json::Value;

pub async fn browser_navigate(_url: &str) -> Value {
    serde_json::json!({
        "success": false,
        "error": "Browser automation is not yet implemented"
    })
}

pub async fn browser_screenshot() -> Value {
    serde_json::json!({
        "success": false,
        "error": "Browser automation is not yet implemented"
    })
}

pub async fn browser_click(_selector: &str) -> Value {
    serde_json::json!({
        "success": false,
        "error": "Browser automation is not yet implemented"
    })
}

pub async fn browser_type(_selector: &str, _text: &str) -> Value {
    serde_json::json!({
        "success": false,
        "error": "Browser automation is not yet implemented"
    })
}
