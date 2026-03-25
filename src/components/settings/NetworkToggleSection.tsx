import { useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useClipboardFeedback } from "../../hooks/useClipboardFeedback";
import { useNetworkStore } from "../../stores/networkStore";

export default function NetworkToggleSection() {
  const tn = useTranslation("network").t;
  const network = useNetworkStore();

  const [networkToggleLoading, setNetworkToggleLoading] = useState(false);
  const { copied: peerIdCopied, copy: copyPeerId } = useClipboardFeedback(2000);
  const hasEnabledBefore = useRef(localStorage.getItem("network_enabled") !== null);
  const [showConsent, setShowConsent] = useState(false);

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
              onClick={() => copyPeerId(network.peerId!)}
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
