use base64::Engine;
use headless_chrome::protocol::cdp::Page;
use serde_json::Value;

use super::browser_manager::BrowserManager;

pub async fn browser_navigate(url: &str) -> Value {
    if url.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "URL is required"
        });
    }

    let url = url.to_string();
    tokio::task::spawn_blocking(move || {
        if let Err(e) = BrowserManager::ensure_running() {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to start browser: {}", e)
            });
        }

        match BrowserManager::with_tab(|tab| {
            tab.navigate_to(&url)
                .map_err(|e| format!("Navigation failed: {}", e))?;
            tab.wait_until_navigated()
                .map_err(|e| format!("Page load timeout: {}", e))?;
            Ok(url.clone())
        }) {
            Ok(navigated_url) => serde_json::json!({
                "success": true,
                "url": navigated_url
            }),
            Err(e) => serde_json::json!({
                "success": false,
                "error": e
            }),
        }
    })
    .await
    .unwrap_or_else(|e| {
        serde_json::json!({
            "success": false,
            "error": format!("Task join error: {}", e)
        })
    })
}

pub async fn browser_screenshot() -> Value {
    tokio::task::spawn_blocking(|| {
        match BrowserManager::with_tab(|tab| {
            let png_data = tab
                .capture_screenshot(
                    Page::CaptureScreenshotFormatOption::Png,
                    None,
                    None,
                    true,
                )
                .map_err(|e| format!("Screenshot failed: {}", e))?;

            let b64 = base64::engine::general_purpose::STANDARD.encode(&png_data);
            Ok(b64)
        }) {
            Ok(b64) => serde_json::json!({
                "success": true,
                "screenshot": b64,
                "format": "png",
                "encoding": "base64"
            }),
            Err(e) => serde_json::json!({
                "success": false,
                "error": e
            }),
        }
    })
    .await
    .unwrap_or_else(|e| {
        serde_json::json!({
            "success": false,
            "error": format!("Task join error: {}", e)
        })
    })
}

pub async fn browser_click(selector: &str) -> Value {
    if selector.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "CSS selector is required"
        });
    }

    let selector = selector.to_string();
    tokio::task::spawn_blocking(move || {
        match BrowserManager::with_tab(|tab| {
            let element = tab
                .find_element(&selector)
                .map_err(|e| format!("Element not found '{}': {}", selector, e))?;
            element
                .click()
                .map_err(|e| format!("Click failed: {}", e))?;
            Ok(())
        }) {
            Ok(()) => serde_json::json!({
                "success": true,
                "selector": selector
            }),
            Err(e) => serde_json::json!({
                "success": false,
                "error": e
            }),
        }
    })
    .await
    .unwrap_or_else(|e| {
        serde_json::json!({
            "success": false,
            "error": format!("Task join error: {}", e)
        })
    })
}

pub async fn browser_type(selector: &str, text: &str) -> Value {
    if selector.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "CSS selector is required"
        });
    }

    let selector = selector.to_string();
    let text = text.to_string();
    tokio::task::spawn_blocking(move || {
        match BrowserManager::with_tab(|tab| {
            let element = tab
                .find_element(&selector)
                .map_err(|e| format!("Element not found '{}': {}", selector, e))?;
            element
                .click()
                .map_err(|e| format!("Focus failed: {}", e))?;
            element
                .type_into(&text)
                .map_err(|e| format!("Type failed: {}", e))?;
            Ok(())
        }) {
            Ok(()) => serde_json::json!({
                "success": true,
                "selector": selector,
                "text": text
            }),
            Err(e) => serde_json::json!({
                "success": false,
                "error": e
            }),
        }
    })
    .await
    .unwrap_or_else(|e| {
        serde_json::json!({
            "success": false,
            "error": format!("Task join error: {}", e)
        })
    })
}
