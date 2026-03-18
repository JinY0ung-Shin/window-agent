import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Download, Upload } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { exportAgent, importAgent } from "../../services/tauriCommands";
import type { ImportResult } from "../../services/tauriCommands";

export default function ExportSection() {
  const { t } = useTranslation("glossary");
  const uiTheme = useSettingsStore((s) => s.uiTheme);
  const ta = useTranslation("agent").t;
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [includeConversations, setIncludeConversations] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = async () => {
    if (!selectedAgentId) return;
    setExporting(true);
    setError("");
    try {
      const bytes = await exportAgent(selectedAgentId, includeConversations);
      const agent = agents.find((a) => a.id === selectedAgentId);
      const fileName = `${agent?.folder_name ?? "agent"}-export.zip`;

      const blob = new Blob([new Uint8Array(bytes)], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(ta("export.exportFailed", { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setExporting(false);
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setError("");
    setResult(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const bytes = Array.from(new Uint8Array(arrayBuffer));
      const importResult = await importAgent(bytes);
      setResult(importResult);
      await loadAgents();
    } catch (err) {
      setError(ta("export.importFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="form-group">
        <label>{t("exportAgent", { context: uiTheme })}</label>
        <div className="export-row">
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="export-agent-select"
          >
            <option value="">{t("selectAgentExport", { context: uiTheme })}</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <label className="export-checkbox">
            <input
              type="checkbox"
              checked={includeConversations}
              onChange={(e) => setIncludeConversations(e.target.checked)}
            />
            {ta("export.includeConversations")}
          </label>
          <button
            className="btn-secondary export-btn"
            onClick={handleExport}
            disabled={!selectedAgentId || exporting}
          >
            <Download size={14} />
            {exporting ? ta("export.exporting") : ta("export.exportButton")}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>{t("importAgent", { context: uiTheme })}</label>
        <div className="export-row">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            onChange={handleImport}
            style={{ display: "none" }}
          />
          <button
            className="btn-secondary export-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={importing}
          >
            <Upload size={14} />
            {importing ? t("importing", { context: uiTheme }) : ta("export.importButton")}
          </button>
        </div>
      </div>

      {error && <div className="export-error">{error}</div>}

      {result && (
        <div className="export-result">
          <p>
            {t("importResult", {
              agents: result.agents_imported,
              convs: result.conversations_imported,
              msgs: result.messages_imported,
              context: uiTheme,
            })}
          </p>
          {result.warnings.map((w, i) => (
            <p key={i} className="export-warning">{w}</p>
          ))}
        </div>
      )}
    </>
  );
}
