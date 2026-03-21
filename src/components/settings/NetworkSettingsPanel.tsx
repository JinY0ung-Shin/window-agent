import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNetworkStore } from "../../stores/networkStore";
import { p2pGetRelayUrl, p2pSetRelayUrl } from "../../services/commands/p2pCommands";

interface Props {
  isOpen: boolean;
}

export default function NetworkSettingsPanel({ isOpen }: Props) {
  const { t } = useTranslation("settings");
  const tn = useTranslation("network").t;
  const network = useNetworkStore();

  const [networkToggleLoading, setNetworkToggleLoading] = useState(false);
  const [peerIdCopied, setPeerIdCopied] = useState(false);
  const hasEnabledBefore = useRef(localStorage.getItem("network_enabled") !== null);
  const [showConsent, setShowConsent] = useState(false);
  const [tempRelayUrl, setTempRelayUrl] = useState("");
  const [relaySaving, setRelaySaving] = useState(false);
  const [relaySaved, setRelaySaved] = useState(false);
  const [relayError, setRelayError] = useState("");

  useEffect(() => {
    if (isOpen) {
      p2pGetRelayUrl().then((url) => {
        setTempRelayUrl(url);
        setRelaySaved(false);
        setRelayError("");
      }).catch(() => {});
    }
  }, [isOpen]);

  return (
    <>
      {showConsent && (
        <div className="network-consent">
          <p><strong>{tn("consent.title")}</strong></p>
          <p>
            {tn("consent.description")}
          </p>
          <div className="network-consent-actions">
            <button
              className="btn-secondary"
              onClick={() => setShowConsent(false)}
            >
              {tn("consent.cancel")}
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                setShowConsent(false);
                setNetworkToggleLoading(true);
                try {
                  await network.startNetwork();
                  hasEnabledBefore.current = true;
                } finally {
                  setNetworkToggleLoading(false);
                }
              }}
            >
              {tn("consent.agreeAndEnable")}
            </button>
          </div>
        </div>
      )}

      <div className="form-group">
        <div className="toggle-row">
          <label>{tn("toggle.label")}</label>
          <button
            className={`toggle-switch ${network.networkEnabled ? "on" : ""}`}
            disabled={networkToggleLoading}
            onClick={async () => {
              if (network.networkEnabled) {
                setNetworkToggleLoading(true);
                try {
                  await network.stopNetwork();
                } finally {
                  setNetworkToggleLoading(false);
                }
              } else if (!hasEnabledBefore.current) {
                setShowConsent(true);
              } else {
                setNetworkToggleLoading(true);
                try {
                  await network.startNetwork();
                } finally {
                  setNetworkToggleLoading(false);
                }
              }
            }}
          >
            <span className="toggle-knob" />
          </button>
        </div>
        <p className="form-text">
          {tn("toggle.hint")}
        </p>
      </div>

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
                await p2pSetRelayUrl(val);
                setRelaySaved(true);
              } catch (e) {
                setRelayError(e instanceof Error ? e.message : String(e));
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
      </div>

      <div className="form-group">
        <label>{tn("status.label")}</label>
        <div className="network-status-row">
          <span className={`network-status-dot network-status-${network.status}`} />
          <span>
            {network.status === "dormant" && tn("status.dormant")}
            {network.status === "starting" && tn("status.starting")}
            {network.status === "active" && tn("status.active")}
            {network.status === "stopping" && tn("status.stopping")}
            {network.status === "reconnecting" && tn("status.reconnecting")}
          </span>
          {network.networkEnabled && (
            <span className="network-peer-count">
              {tn("status.connectedPeers", { count: network.connectedPeers.size })}
            </span>
          )}
        </div>
      </div>

      {network.peerId && (
        <div className="form-group">
          <label>{tn("peerId.label")}</label>
          <div className="peer-id-display">
            <code>{network.peerId}</code>
            <button
              className="btn-secondary peer-id-copy-btn"
              onClick={() => {
                navigator.clipboard.writeText(network.peerId!);
                setPeerIdCopied(true);
                setTimeout(() => setPeerIdCopied(false), 2000);
              }}
            >
              {peerIdCopied ? tn("peerId.copied") : tn("peerId.copy")}
            </button>
          </div>
        </div>
      )}

      {network.error && (
        <p className="form-text text-error">{network.error}</p>
      )}
    </>
  );
}
