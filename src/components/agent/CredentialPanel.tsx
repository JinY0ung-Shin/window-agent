import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ToolConfig, CredentialMeta } from "../../services/types";
import { listCredentials } from "../../services/commands/credentialCommands";

interface Props {
  toolConfig: ToolConfig | null;
  onChange: (config: ToolConfig) => void;
}

export default function CredentialPanel({ toolConfig, onChange }: Props) {
  const { t } = useTranslation("agent");
  const [credentials, setCredentials] = useState<CredentialMeta[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listCredentials()
      .then(setCredentials)
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="native-tool-panel"><span className="native-tool-loading">{t("tools.loading")}</span></div>;
  }

  if (credentials.length === 0) {
    return (
      <div className="native-tool-panel">
        <div className="native-tool-empty">{t("credentials.noCredentialsHint")}</div>
      </div>
    );
  }

  if (!toolConfig) return null;

  const toggleCredential = (credId: string, allowed: boolean) => {
    const current = toolConfig.credentials ?? {};
    onChange({
      ...toolConfig,
      credentials: {
        ...current,
        [credId]: { allowed },
      },
    });
  };

  return (
    <div className="native-tool-panel">
      <div className="native-tool-group">
        <div className="native-tool-group-header">
          <span>{t("credentials.title")}</span>
          <span className="native-tool-group-count">{credentials.length}</span>
        </div>
        {credentials.map((cred) => {
          const allowed = toolConfig.credentials?.[cred.id]?.allowed ?? false;
          return (
            <div key={cred.id} className={`native-tool-row ${allowed ? "" : "disabled"}`}>
              <input
                type="checkbox"
                checked={allowed}
                onChange={(e) => toggleCredential(cred.id, e.target.checked)}
              />
              <span className="native-tool-name">{cred.name}</span>
              <span className="native-tool-desc">{cred.id}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
