import { useState, useRef } from "react";
import { Download, Upload } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { exportAgent, importAgent } from "../../services/tauriCommands";
import type { ImportResult } from "../../services/tauriCommands";
import { useLabels } from "../../hooks/useLabels";

export default function ExportSection() {
  const labels = useLabels();
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
      setError(`내보내기 실패: ${e instanceof Error ? e.message : String(e)}`);
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
      setError(`불러오기 실패: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="form-group">
        <label>{labels.exportAgent}</label>
        <div className="export-row">
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="export-agent-select"
          >
            <option value="">{labels.selectAgentExport}</option>
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
            {labels.exportIncludeConversations}
          </label>
          <button
            className="btn-secondary export-btn"
            onClick={handleExport}
            disabled={!selectedAgentId || exporting}
          >
            <Download size={14} />
            {exporting ? labels.exporting : labels.exportButton}
          </button>
        </div>
      </div>

      <div className="form-group">
        <label>{labels.importAgent}</label>
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
            {importing ? labels.importing : labels.importButton}
          </button>
        </div>
      </div>

      {error && <div className="export-error">{error}</div>}

      {result && (
        <div className="export-result">
          <p>
            {labels.importResult(result.agents_imported, result.conversations_imported, result.messages_imported, result.memory_notes_imported)}
          </p>
          {result.warnings.map((w, i) => (
            <p key={i} className="export-warning">{w}</p>
          ))}
        </div>
      )}
    </>
  );
}
