import { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useNetworkStore } from "../../stores/networkStore";
import { p2pGetListenPort, p2pSetListenPort, p2pGetConnectionInfo } from "../../services/commands/p2pCommands";

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
  const [configuredPort, setConfiguredPort] = useState<number | null>(null);
  const [activePort, setActivePort] = useState<number | null>(null);
  const [tempPort, setTempPort] = useState("");
  const [portSaving, setPortSaving] = useState(false);
  const [portSaved, setPortSaved] = useState(false);
  const [portError, setPortError] = useState("");

  useEffect(() => {
    if (isOpen) {
      p2pGetListenPort().then((p) => {
        setConfiguredPort(p);
        setTempPort(p != null ? String(p) : "");
        setPortSaved(false);
        setPortError("");
      }).catch(() => {});
      p2pGetConnectionInfo().then((info) => {
        setActivePort(info.active_listen_port ?? null);
      }).catch(() => setActivePort(null));
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
        <label htmlFor="listenPort">{tn("port.label")}</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            id="listenPort"
            type="number"
            min={1}
            max={65535}
            placeholder={tn("port.placeholder")}
            value={tempPort}
            onChange={(e) => {
              setTempPort(e.target.value);
              setPortSaved(false);
              setPortError("");
            }}
            style={{ flex: 1 }}
          />
          <button
            className="btn-secondary"
            disabled={portSaving}
            onClick={async () => {
              setPortError("");
              const val = tempPort.trim();
              const portNum = val === "" ? null : Number(val);
              if (portNum != null && (isNaN(portNum) || portNum < 1 || portNum > 65535 || !Number.isInteger(portNum))) {
                setPortError(tn("port.validationError"));
                return;
              }
              setPortSaving(true);
              try {
                await p2pSetListenPort(portNum);
                setConfiguredPort(portNum);
                setPortSaved(true);
              } catch (e) {
                setPortError(e instanceof Error ? e.message : String(e));
              } finally {
                setPortSaving(false);
              }
            }}
          >
            {portSaving ? t("common:saving") : t("common:save")}
          </button>
        </div>
        {portSaved && (
          <p className="form-text text-success">
            {tn("port.saved")}
          </p>
        )}
        {portError && (
          <p className="form-text text-error">{portError}</p>
        )}
        {network.status === "active" && activePort != null && (
          <p className="form-text">
            {tn("port.activePort", { port: activePort })}
            {configuredPort != null && activePort !== configuredPort && ` ${tn("port.portMismatch")}`}
          </p>
        )}
        <p className="form-text">
          {tn("port.hint")}
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
          </span>
          {network.networkEnabled && (
            <span className="network-peer-count">
              {tn("status.connectedPeers", { count: network.contacts.filter((c) => c.status === "connected").length })}
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
