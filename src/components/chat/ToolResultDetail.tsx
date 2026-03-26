import { convertFileSrc } from "@tauri-apps/api/core";
import { isBrowserTool, parseBrowserResult } from "./toolCallUtils";

interface ToolResultDetailProps {
  toolName: string;
  result: string;
  isError?: boolean;
}

export default function ToolResultDetail({ toolName, result, isError = false }: ToolResultDetailProps) {
  if (toolName === "run_command") {
    try {
      const parsed = JSON.parse(result);
      if (parsed && typeof parsed.exit_code === "number") {
        const exitOk = parsed.exit_code === 0;
        return (
          <div className="command-result">
            <div className={`command-exit-code ${exitOk ? "" : "command-exit-error"}`}>
              exit: {parsed.exit_code}{parsed.truncated ? " (truncated)" : ""}
            </div>
            {parsed.stdout && (
              <pre className="command-stdout">{parsed.stdout}</pre>
            )}
            {parsed.stderr && (
              <pre className="command-stderr">{parsed.stderr}</pre>
            )}
          </div>
        );
      }
    } catch { /* fall through to default */ }
  }

  if (isBrowserTool(toolName)) {
    const browserResult = parseBrowserResult(result);
    if (browserResult) {
      return (
        <div className="browser-result">
          {browserResult.url && (
            <div className="browser-url-bar">
              <span className="browser-url-label">[URL]</span>
              <span className="browser-url-value">{browserResult.url}</span>
              {browserResult.title && (
                <span className="browser-url-title">{browserResult.title}</span>
              )}
            </div>
          )}
          {browserResult.screenshot_path && (
            <div className="browser-screenshot-frame">
              <img
                src={convertFileSrc(browserResult.screenshot_path)}
                alt="Browser screenshot"
                className="browser-screenshot"
                style={{ maxHeight: "200px" }}
                onClick={(event) => {
                  const img = event.currentTarget;
                  img.style.maxHeight = img.style.maxHeight === "200px" ? "none" : "200px";
                }}
              />
            </div>
          )}
          {browserResult.snapshot && (
            <details open={!browserResult.screenshot_path}>
              <summary className="browser-snapshot-summary">
                Accessibility Snapshot ({browserResult.elementCount} elements)
              </summary>
              <pre className="browser-snapshot-content">{browserResult.snapshot}</pre>
            </details>
          )}
        </div>
      );
    }
  }

  return (
    <pre className={`tool-call-result ${isError ? "tool-result-error" : ""}`}>
      {result}
    </pre>
  );
}
