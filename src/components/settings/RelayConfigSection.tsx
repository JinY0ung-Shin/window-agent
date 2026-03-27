import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { relayGetRelayUrl, relaySetRelayUrl, relayGetDirectorySettings, relaySetDirectorySettings } from "../../services/commands/relayCommands";
import { toErrorMessage } from "../../utils/errorUtils";

interface Props {
  isOpen: boolean;
}

export default function RelayConfigSection({ isOpen }: Props) {
  const { t } = useTranslation("settings");
  const tn = useTranslation("network").t;

  const [tempRelayUrl, setTempRelayUrl] = useState("");
  const [relaySaving, setRelaySaving] = useState(false);
  const [relaySaved, setRelaySaved] = useState(false);
  const [relayError, setRelayError] = useState("");
  const [discoverable, setDiscoverable] = useState(true);

  useEffect(() => {
    if (isOpen) {
      relayGetRelayUrl().then((url) => {
        setTempRelayUrl(url);
        setRelaySaved(false);
        setRelayError("");
      }).catch(() => {});
      relayGetDirectorySettings().then((settings) => {
        setDiscoverable(settings.discoverable);
      }).catch(() => {});
    }
  }, [isOpen]);

  return (
    <div className="form-group">
      <label htmlFor="relayUrl">{tn("relay.label")}</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          id="relayUrl"
          type="text"
          placeholder={tn("relay.placeholder")}
          value={tempRelayUrl}
          onChange={(e) => {
            setTempRelayUrl(e.target.value);
            setRelaySaved(false);
            setRelayError("");
          }}
          style={{ flex: 1 }}
        />
        <button
          className="btn-secondary"
          disabled={relaySaving}
          onClick={async () => {
            setRelayError("");
            const val = tempRelayUrl.trim();
            if (val && !val.startsWith("ws://") && !val.startsWith("wss://")) {
              setRelayError(tn("relay.validationError"));
              return;
            }
            setRelaySaving(true);
            try {
              await relaySetRelayUrl(val);
              setRelaySaved(true);
            } catch (e) {
              setRelayError(toErrorMessage(e));
            } finally {
              setRelaySaving(false);
            }
          }}
        >
          {relaySaving ? t("common:saving") : t("common:save")}
        </button>
      </div>
      {relaySaved && (
        <p className="form-text text-success">
          {tn("relay.saved")}
        </p>
      )}
      {relayError && (
        <p className="form-text text-error">{relayError}</p>
      )}
      <p className="form-text">
        {tn("relay.hint")}
      </p>

      <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          id="discoverable"
          checked={discoverable}
          onChange={async (e) => {
            const val = e.target.checked;
            setDiscoverable(val);
            try {
              await relaySetDirectorySettings(val);
            } catch { /* ignore */ }
          }}
        />
        <label htmlFor="discoverable" style={{ margin: 0 }}>
          {tn("directory.discoverableLabel")}
        </label>
      </div>
      <p className="form-text">{tn("directory.discoverableHint")}</p>
    </div>
  );
}
