import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { relayGetAllowedTools, relaySetAllowedTools } from "../../services/commands/relayCommands";
import { logger } from "../../services/logger";

const ALL_RELAY_TOOLS = [
  "read_file",
  "list_directory",
  "write_file",
  "delete_file",
  "web_search",
  "self_inspect",
  "manage_schedule",
] as const;

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
  const [relayToolsDirty, setRelayToolsDirty] = useState(false);
  const [relayToolsError, setRelayToolsError] = useState("");

  useEffect(() => {
    if (isOpen) {
      relayGetAllowedTools().then((tools) => {
        if (tools.length > 0) setRelayTools(tools);
        else setRelayTools(DEFAULT_RELAY_TOOLS);
        setRelayToolsSaved(false);
        setRelayToolsDirty(false);
        setRelayToolsError("");
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
        {ALL_RELAY_TOOLS.map((toolName) => (
          <label key={toolName} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.8125rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={relayTools.includes(toolName)}
              onChange={(e) => {
                setRelayToolsSaved(false);
                setRelayToolsDirty(true);
                if (e.target.checked) {
                  setRelayTools((prev) => [...prev, toolName]);
                } else {
                  setRelayTools((prev) => prev.filter((n) => n !== toolName));
                }
              }}
            />
            {t(`relayTools.names.${toolName}`)}
          </label>
        ))}
      </div>
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button
          className="btn-secondary"
          disabled={relayToolsSaving}
          onClick={async () => {
            setRelayToolsSaving(true);
            setRelayToolsError("");
            try {
              await relaySetAllowedTools(relayTools);
              setRelayToolsSaved(true);
              setRelayToolsDirty(false);
            } catch (e) {
              logger.debug("Failed to save relay tools", e);
              setRelayToolsError(t("common:errors.saveFailed"));
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
            setRelayToolsDirty(true);
          }}
        >
          {tn("tools.reset")}
        </button>
      </div>
      {relayToolsError && (
        <p className="form-text text-error">{relayToolsError}</p>
      )}
      {relayToolsDirty && !relayToolsSaved && (
        <p className="form-text text-error">{t("relayTools.unsaved")}</p>
      )}
      {relayToolsSaved && (
        <p className="form-text text-success">
          {tn("tools.saved")}
        </p>
      )}
    </div>
  );
}
