import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { i18n } from "../../i18n";
import { useDebugStore, type HttpLogEntry } from "../../stores/debugStore";
import { useConversationStore } from "../../stores/conversationStore";

const STATUS_COLORS: Record<string, string> = {
  executed: "var(--success, #22c55e)",
  completed: "var(--success, #22c55e)",
  error: "var(--error, #ef4444)",
  denied: "var(--warning, #e6a817)",
  pending: "var(--text-muted)",
};

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    const intlLocale = i18n.language === "en" ? "en-US" : "ko-KR";
    return d.toLocaleTimeString(intlLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatJson(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function httpStatusColor(status: number | null): string {
  if (!status) return "var(--error, #ef4444)";
  if (status < 300) return "var(--success, #22c55e)";
  if (status < 400) return "var(--warning, #e6a817)";
  return "var(--error, #ef4444)";
}

function HttpLogItem({ log, t }: { log: HttpLogEntry; t: (key: string) => string }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="debug-log-item">
      <div
        className="debug-log-summary"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="debug-log-expand">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="debug-log-time">{formatTime(log.timestamp)}</span>
        <span className="debug-log-tool" style={{ fontFamily: "monospace", fontSize: "0.75rem" }}>
          {log.method}
        </span>
        <span
          className="debug-status-badge"
          style={{ background: httpStatusColor(log.status) }}
        >
          {log.status ?? "ERR"}
        </span>
        {log.duration_ms != null && (
          <span className="debug-log-duration">{log.duration_ms}ms</span>
        )}
        {log.error && (
          <span style={{ color: "var(--error, #ef4444)", fontSize: "0.75rem", marginLeft: 4 }}>
            {log.error}
          </span>
        )}
      </div>

      {expanded && (
        <div className="debug-log-detail">
          <div className="debug-log-section">
            <span className="debug-log-label">URL</span>
            <pre className="debug-code-block" style={{ wordBreak: "break-all" }}>{log.url}</pre>
          </div>
          <div className="debug-log-section">
            <span className="debug-log-label">{t("debug.requestHeaders")}</span>
            <pre className="debug-code-block">{log.request_headers || t("common:none")}</pre>
          </div>
          {log.response_headers && (
            <div className="debug-log-section">
              <span className="debug-log-label">{t("debug.responseHeaders")}</span>
              <pre className="debug-code-block">{log.response_headers}</pre>
            </div>
          )}
          {log.response_body_preview && (
            <div className="debug-log-section">
              <span className="debug-log-label">{t("debug.responsePreview")}</span>
              <pre className="debug-code-block">{formatJson(log.response_body_preview)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function DebugPanel() {
  const { t } = useTranslation("chat");
  const isOpen = useDebugStore((s) => s.isOpen);
  const setOpen = useDebugStore((s) => s.setOpen);
  const logs = useDebugStore((s) => s.logs);
  const httpLogs = useDebugStore((s) => s.httpLogs);
  const activeTab = useDebugStore((s) => s.activeTab);
  const setActiveTab = useDebugStore((s) => s.setActiveTab);
  const filterByTool = useDebugStore((s) => s.filterByTool);
  const filterByStatus = useDebugStore((s) => s.filterByStatus);
  const setFilterByTool = useDebugStore((s) => s.setFilterByTool);
  const setFilterByStatus = useDebugStore((s) => s.setFilterByStatus);
  const loadLogs = useDebugStore((s) => s.loadLogs);
  const getFilteredLogs = useDebugStore((s) => s.getFilteredLogs);
  const clearHttpLogs = useDebugStore((s) => s.clearHttpLogs);
  const setupHttpLogListener = useDebugStore((s) => s.setupHttpLogListener);

  const currentConversationId = useConversationStore((s) => s.currentConversationId);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Setup HTTP log listener
  useEffect(() => {
    let cleanup: (() => void) | undefined;
    setupHttpLogListener().then((fn) => { cleanup = fn; });
    return () => { cleanup?.(); };
  }, [setupHttpLogListener]);

  useEffect(() => {
    if (isOpen && currentConversationId && activeTab === "tools") {
      loadLogs(currentConversationId);
    }
  }, [isOpen, currentConversationId, loadLogs, activeTab]);

  const toolNames = useMemo(() => {
    const names = new Set(logs.map((l) => l.tool_name));
    return Array.from(names).sort();
  }, [logs]);

  const allStatuses = useMemo(() => {
    const s = new Set(logs.map((l) => l.status));
    return Array.from(s).sort();
  }, [logs]);

  const filteredLogs = getFilteredLogs();

  const toggleStatus = (status: string) => {
    if (filterByStatus.includes(status)) {
      setFilterByStatus(filterByStatus.filter((s) => s !== status));
    } else {
      setFilterByStatus([...filterByStatus, status]);
    }
  };

  return (
    <div className={`debug-panel ${isOpen ? "open" : ""}`}>
      <div className="debug-panel-header">
        <div className="debug-tab-bar">
          <button
            className={`debug-tab ${activeTab === "tools" ? "active" : ""}`}
            onClick={() => setActiveTab("tools")}
          >
            {t("debug.toolLog")}
          </button>
          <button
            className={`debug-tab ${activeTab === "http" ? "active" : ""}`}
            onClick={() => setActiveTab("http")}
          >
            HTTP {httpLogs.length > 0 && <span className="debug-tab-count">{httpLogs.length}</span>}
          </button>
        </div>
        <button className="debug-panel-close" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>

      {activeTab === "tools" ? (
        <>
          <div className="debug-panel-filters">
            <select
              className="debug-filter-select"
              value={filterByTool ?? ""}
              onChange={(e) => setFilterByTool(e.target.value || null)}
            >
              <option value="">{t("debug.allTools")}</option>
              {toolNames.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>

            <div className="debug-filter-statuses">
              {allStatuses.map((status) => (
                <label key={status} className="debug-status-checkbox">
                  <input
                    type="checkbox"
                    checked={filterByStatus.length === 0 || filterByStatus.includes(status)}
                    onChange={() => toggleStatus(status)}
                  />
                  <span
                    className="debug-status-dot"
                    style={{ background: STATUS_COLORS[status] ?? "var(--text-muted)" }}
                  />
                  {statusLabel(status)}
                </label>
              ))}
            </div>
          </div>

          <div className="debug-panel-logs">
            {filteredLogs.length === 0 ? (
              <div className="debug-empty">{t("debug.noToolLogs")}</div>
            ) : (
              filteredLogs.map((log) => {
                const isExpanded = expandedId === log.id;
                return (
                  <div key={log.id} className="debug-log-item">
                    <div
                      className="debug-log-summary"
                      onClick={() => setExpandedId(isExpanded ? null : log.id)}
                    >
                      <span className="debug-log-expand">
                        {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </span>
                      <span className="debug-log-time">{formatTime(log.created_at)}</span>
                      <span className="debug-log-tool">{log.tool_name}</span>
                      <span
                        className="debug-status-badge"
                        style={{ background: STATUS_COLORS[log.status] ?? "var(--text-muted)" }}
                      >
                        {statusLabel(log.status)}
                      </span>
                      {log.duration_ms != null && (
                        <span className="debug-log-duration">{log.duration_ms}ms</span>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="debug-log-detail">
                        <div className="debug-log-section">
                          <span className="debug-log-label">Input</span>
                          <pre className="debug-code-block">{formatJson(log.tool_input)}</pre>
                        </div>
                        {log.tool_output && (
                          <div className="debug-log-section">
                            <span className="debug-log-label">Output</span>
                            <pre className="debug-code-block">{formatJson(log.tool_output)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      ) : (
        <>
          <div className="debug-panel-filters">
            <button
              className="debug-clear-btn"
              onClick={clearHttpLogs}
              disabled={httpLogs.length === 0}
            >
              {t("debug.clearLogs")}
            </button>
          </div>
          <div className="debug-panel-logs">
            {httpLogs.length === 0 ? (
              <div className="debug-empty">{t("debug.noHttpLogs")}</div>
            ) : (
              [...httpLogs].reverse().map((log) => (
                <HttpLogItem key={log.id} log={log} t={t} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
