import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check, Loader2 } from "lucide-react";
import Modal from "../common/Modal";
import { useClipboardFeedback } from "../../hooks/useClipboardFeedback";
import { useNetworkStore } from "../../stores/networkStore";
import { useAgentStore } from "../../stores/agentStore";
import { toErrorMessage } from "../../utils/errorUtils";

type Tab = "generate" | "accept";

interface Props {
  onClose: () => void;
}

export default function InviteDialog({ onClose }: Props) {
  const { t } = useTranslation("network");
  const [tab, setTab] = useState<Tab>("generate");

  return (
    <Modal
      onClose={onClose}
      title={t("invite.title")}
      overlayClose="stopPropagation"
      contentClassName="invite-dialog"
    >
      <div className="invite-tabs">
          <button
            className={`invite-tab${tab === "generate" ? " active" : ""}`}
            onClick={() => setTab("generate")}
          >
            {t("invite.generate")}
          </button>
          <button
            className={`invite-tab${tab === "accept" ? " active" : ""}`}
            onClick={() => setTab("accept")}
          >
            {t("invite.accept")}
          </button>
        </div>

      {tab === "generate" ? (
        <GenerateTab onClose={onClose} t={t} />
      ) : (
        <AcceptTab onClose={onClose} t={t} />
      )}
    </Modal>
  );
}

function GenerateTab({ onClose, t }: { onClose: () => void; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const agents = useAgentStore((s) => s.agents);
  const generateInvite = useNetworkStore((s) => s.generateInvite);

  const [selectedAgentIdx, setSelectedAgentIdx] = useState(0);
  const [description, setDescription] = useState("");
  const [expiryHours, setExpiryHours] = useState(24);
  const [inviteCode, setInviteCode] = useState("");
  const { copied, copy } = useClipboardFeedback(2000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleGenerate = async () => {
    const agent = agents[selectedAgentIdx];
    if (!agent) return;
    setLoading(true);
    setError("");
    try {
      const code = await generateInvite(
        agent.name,
        description || agent.description,
        expiryHours === 0 ? undefined : expiryHours,
      );
      setInviteCode(code);
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => copy(inviteCode);

  return (
    <div className="invite-tab-content">
      {!inviteCode ? (
        <>
          <div className="form-group">
            <label>{t("invite.representativeAgent")}</label>
            <select
              value={selectedAgentIdx}
              onChange={(e) => setSelectedAgentIdx(Number(e.target.value))}
            >
              {agents.map((a, i) => (
                <option key={a.id} value={i}>{a.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>{t("invite.descriptionOptional")}</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("invite.descriptionPlaceholder")}
            />
          </div>
          <div className="form-group">
            <label>{t("invite.expiry")}</label>
            <select
              value={expiryHours}
              onChange={(e) => setExpiryHours(Number(e.target.value))}
            >
              <option value={24}>{t("invite.hours24")}</option>
              <option value={48}>{t("invite.hours48")}</option>
              <option value={168}>{t("invite.week1")}</option>
              <option value={0}>{t("invite.noExpiry")}</option>
            </select>
          </div>

          {error && <div className="form-text text-error">{error}</div>}
          <button
            className="btn-primary"
            onClick={handleGenerate}
            disabled={loading || agents.length === 0}
          >
            {loading ? <Loader2 size={16} className="spinning" /> : t("invite.generateButton")}
          </button>
        </>
      ) : (
        <>
          <div className="form-group">
            <label>{t("invite.codeLabel")}</label>
            <div className="invite-code-box">
              <textarea readOnly value={inviteCode} rows={4} />
              <button className="icon-btn copy-btn" onClick={handleCopy} title={t("common:copy")}>
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>
            <span className="form-text">{t("invite.shareHint")}</span>
          </div>
          <button className="btn-secondary" onClick={onClose}>{t("common:close")}</button>
        </>
      )}
    </div>
  );
}

interface InvitePreview {
  agent_name?: string;
}

function tryDecodeInvite(code: string): InvitePreview | null {
  try {
    const trimmed = code.trim();
    if (!trimmed) return null;
    // URL-safe base64 no-padding → standard base64
    let b64 = trimmed.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding
    while (b64.length % 4 !== 0) b64 += "=";
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const obj = JSON.parse(json);
    if (typeof obj === "object" && obj !== null) {
      return {
        agent_name: obj.agent_name,
      };
    }
  } catch {
    // Decode failed — not a valid invite yet
  }
  return null;
}

function AcceptTab({ onClose, t }: { onClose: () => void; t: (key: string, opts?: Record<string, unknown>) => string }) {
  const agents = useAgentStore((s) => s.agents);
  const acceptInvite = useNetworkStore((s) => s.acceptInvite);

  const [code, setCode] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const preview = useMemo(() => tryDecodeInvite(code), [code]);

  const handleAccept = async () => {
    if (!code.trim()) return;
    setLoading(true);
    setError("");
    try {
      await acceptInvite(code.trim(), selectedAgentId || undefined);
      onClose();
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="invite-tab-content">
      <div className="form-group">
        <label>{t("invite.pasteLabel")}</label>
        <textarea
          value={code}
          onChange={(e) => setCode(e.target.value)}
          rows={4}
          placeholder={t("invite.pastePlaceholder")}
        />
      </div>
      {preview && (
        <div className="invite-preview">
          <span className="invite-preview-badge">{t("invite.unverified")}</span>
          {preview.agent_name && (
            <div className="invite-preview-row">{t("invite.agentPrefix", { name: preview.agent_name })}</div>
          )}
        </div>
      )}
      <div className="form-group">
        <label>{t("invite.bindingAgent")}</label>
        <select
          value={selectedAgentId}
          onChange={(e) => setSelectedAgentId(e.target.value)}
        >
          <option value="">{t("invite.noSelection")}</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
        <span className="form-text">{t("invite.bindingHint")}</span>
      </div>
      {error && <div className="form-text text-error">{error}</div>}
      <button
        className="btn-primary"
        onClick={handleAccept}
        disabled={loading || !code.trim()}
      >
        {loading ? <Loader2 size={16} className="spinning" /> : t("invite.acceptButton")}
      </button>
    </div>
  );
}
