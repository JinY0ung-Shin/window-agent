import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { relayGetAllowedTools, relaySetAllowedTools } from "../../services/commands/relayCommands";
import { logger } from "../../services/logger";

const ALL_RELAY_TOOLS = [
  { name: "read_file", label: "Read File" },
  { name: "list_directory", label: "List Directory" },
  { name: "write_file", label: "Write File" },
  { name: "delete_file", label: "Delete File" },
  { name: "web_search", label: "Web Search" },
  { name: "self_inspect", label: "Self Inspect" },
  { name: "manage_schedule", label: "Manage Schedule" },
];

const DEFAULT_RELAY_TOOLS = ["read_file", "list_directory", "web_search", "self_inspect"];

interface Props {
  isOpen: boolean;
}

export default function RelayToolsSection({ isOpen }: Props) {
  const { t } = useTranslation("settings");
  const tn = useTranslation("network").t;

  const [relayTools, setRelayTools] = useState<string[]>(DEFAULT_RELAY_TOOLS);
  const [relayToolsSaving, setRelayToolsSaving] = useState(false);
  const [relayToolsSaved, setRelayToolsSaved] = useState(false);

  useEffect(() => {
    if (isOpen) {
      relayGetAllowedTools().then((tools) => {
        if (tools.length > 0) setRelayTools(tools);
        else setRelayTools(DEFAULT_RELAY_TOOLS);
        setRelayToolsSaved(false);
      }).catch(() => {});
    }
  }, [isOpen]);

  return (
    <div className="form-group">
      <label>{tn("tools.label")}</label>
      <p className="form-text" style={{ marginBottom: 8 }}>
        {tn("tools.hint")}
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ALL_RELAY_TOOLS.map((tool) => (
          <label key={tool.name} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={relayTools.includes(tool.name)}
              onChange={(e) => {
                setRelayToolsSaved(false);
                if (e.target.checked) {
                  setRelayTools((prev) => [...prev, tool.name]);
                } else {
                  setRelayTools((prev) => prev.filter((t) => t !== tool.name));
                }
              }}
            />
            {tool.label}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button
          className="btn-secondary"
          disabled={relayToolsSaving}
          onClick={async () => {
            setRelayToolsSaving(true);
            try {
              await relaySetAllowedTools(relayTools);
              setRelayToolsSaved(true);
            } catch (e) {
              logger.debug("Failed to save relay tools", e);
            } finally {
              setRelayToolsSaving(false);
            }
          }}
        >
          {relayToolsSaving ? t("common:saving") : t("common:save")}
        </button>
        <button
          className="btn-secondary"
          onClick={() => {
            setRelayTools(DEFAULT_RELAY_TOOLS);
            setRelayToolsSaved(false);
          }}
        >
          {tn("tools.reset")}
        </button>
      </div>
      {relayToolsSaved && (
        <p className="form-text text-success">
          {tn("tools.saved")}
        </p>
      )}
    </div>
  );
}
