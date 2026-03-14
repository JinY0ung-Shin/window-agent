import { useEffect, useState, useMemo } from "react";
import { X, ChevronDown, ChevronRight } from "lucide-react";
import { useDebugStore } from "../../stores/debugStore";
import { useChatStore } from "../../stores/chatStore";

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
    return d.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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

export default function DebugPanel() {
  const isOpen = useDebugStore((s) => s.isOpen);
  const setOpen = useDebugStore((s) => s.setOpen);
  const logs = useDebugStore((s) => s.logs);
  const filterByTool = useDebugStore((s) => s.filterByTool);
  const filterByStatus = useDebugStore((s) => s.filterByStatus);
  const setFilterByTool = useDebugStore((s) => s.setFilterByTool);
  const setFilterByStatus = useDebugStore((s) => s.setFilterByStatus);
  const loadLogs = useDebugStore((s) => s.loadLogs);
  const getFilteredLogs = useDebugStore((s) => s.getFilteredLogs);

  const currentConversationId = useChatStore((s) => s.currentConversationId);

  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && currentConversationId) {
      loadLogs(currentConversationId);
    }
  }, [isOpen, currentConversationId, loadLogs]);

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
        <h3>도구 로그</h3>
        <button className="debug-panel-close" onClick={() => setOpen(false)}>
          <X size={18} />
        </button>
      </div>

      <div className="debug-panel-filters">
        <select
          className="debug-filter-select"
          value={filterByTool ?? ""}
          onChange={(e) => setFilterByTool(e.target.value || null)}
        >
          <option value="">모든 도구</option>
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
          <div className="debug-empty">도구 호출 기록이 없습니다</div>
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
    </div>
  );
}
