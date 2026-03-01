use reqwest::Client;
use scraper::{Html, Selector};
use serde_json::Value;
use std::time::Duration;

pub async fn web_fetch(url: &str) -> Value {
    if url.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "URL is required"
        });
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("WindowAgent/0.1 (Desktop App)")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to create HTTP client: {}", e)
            });
        }
    };

    let response = match client.get(url).send().await {
        Ok(r) => r,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Request failed: {}", e)
            });
        }
    };

    let status_code = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let body = match response.text().await {
        Ok(b) => b,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to read response body: {}", e)
            });
        }
    };

    let content = if content_type.contains("text/html") {
        strip_html_tags(&body)
    } else {
        body
    };

    // Truncate very long content
    let content = if content.len() > 50_000 {
        format!("{}...(truncated)", &content[..50_000])
    } else {
        content
    };

    serde_json::json!({
        "success": true,
        "url": url,
        "content": content,
        "content_type": content_type,
        "status_code": status_code
    })
}

pub async fn web_search(query: &str) -> Value {
    if query.is_empty() {
        return serde_json::json!({
            "success": false,
            "error": "Search query is required"
        });
    }

    let client = match Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
    {
        Ok(c) => c,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to create HTTP client: {}", e)
            });
        }
    };

    let response = match client
        .get("https://html.duckduckgo.com/html/")
        .query(&[("q", query)])
        .send()
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Search request failed: {}", e)
            });
        }
    };

    let body = match response.text().await {
        Ok(b) => b,
        Err(e) => {
            return serde_json::json!({
                "success": false,
                "error": format!("Failed to read search results: {}", e)
            });
        }
    };

    let results = parse_duckduckgo_results(&body);

    serde_json::json!({
        "success": true,
        "query": query,
        "results": results
    })
}

fn strip_html_tags(html: &str) -> String {
    let document = Html::parse_document(html);
    let text: String = document
        .root_element()
        .text()
        .collect::<Vec<_>>()
        .join(" ");
    // Collapse whitespace
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn parse_duckduckgo_results(html: &str) -> Vec<Value> {
    let document = Html::parse_document(html);
    let result_selector = Selector::parse(".result").unwrap();
    let title_selector = Selector::parse(".result__a").unwrap();
    let snippet_selector = Selector::parse(".result__snippet").unwrap();

    let mut results = Vec::new();

    for result in document.select(&result_selector).take(10) {
        let title = result
            .select(&title_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        if title.trim().is_empty() {
            continue;
        }

        let snippet = result
            .select(&snippet_selector)
            .next()
            .map(|el| el.text().collect::<String>())
            .unwrap_or_default();

        let url = result
            .select(&title_selector)
            .next()
            .and_then(|el| el.value().attr("href"))
            .map(|href| extract_url_from_ddg_href(href))
            .unwrap_or_default();

        results.push(serde_json::json!({
            "title": title.trim(),
            "url": url,
            "snippet": snippet.trim()
        }));
    }

    results
}

fn extract_url_from_ddg_href(href: &str) -> String {
    // DuckDuckGo wraps URLs: //duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com&rut=...
    if let Some(pos) = href.find("uddg=") {
        let start = pos + 5;
        let end = href[start..]
            .find('&')
            .map(|p| start + p)
            .unwrap_or(href.len());
        percent_decode(&href[start..end])
    } else {
        href.to_string()
    }
}

fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::new();
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let hi = chars.next().unwrap_or(0);
            let lo = chars.next().unwrap_or(0);
            let hex = [hi, lo];
            if let Ok(s) = std::str::from_utf8(&hex) {
                if let Ok(byte) = u8::from_str_radix(s, 16) {
                    bytes.push(byte);
                    continue;
                }
            }
            bytes.push(b);
            bytes.push(hi);
            bytes.push(lo);
        } else if b == b'+' {
            bytes.push(b' ');
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8_lossy(&bytes).to_string()
}
