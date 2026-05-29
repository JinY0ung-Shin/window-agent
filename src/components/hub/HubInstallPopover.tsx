import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Loader2, Check, AlertTriangle } from "lucide-react";
import { useAgentStore } from "../../stores/agentStore";
import { useHubStore } from "../../stores/hubStore";
import type { SharedSkill, SharedNote } from "../../services/commands/hubCommands";

interface Props {
  type: "skill" | "note" | "agent";
  skill?: SharedSkill;
  note?: SharedNote;
  onClose: () => void;
}

export default function HubInstallPopover({ type, skill, note, onClose }: Props) {
  const { t } = useTranslation(["hub", "common"]);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const executeInstallSkill = useHubStore((s) => s.executeInstallSkill);
  const executeInstallNote = useHubStore((s) => s.executeInstallNote);
  const executeInstallBulk = useHubStore((s) => s.executeInstallBulk);
  const popRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ installed: string[]; skipped: string[]; errors: string[] } | null>(null);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

  // Remember the element that opened the popover, restore focus to it on close
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement | null;
    return () => {
      triggerRef.current?.focus?.();
    };
  }, []);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const handleSelect = async (agent: { id: string; folder_name: string }) => {
    setLoading(true);
    let res;
    if (type === "skill" && skill) {
      res = await executeInstallSkill(agent.folder_name, skill);
    } else if (type === "note" && note) {
      res = await executeInstallNote(agent.id, note);
    } else if (type === "agent") {
      res = await executeInstallBulk(agent.folder_name, agent.id);
    }
    setLoading(false);
    if (res) setResult(res);
  };

  return (
    <div ref={popRef} className="hub-install-popover" role="menu">
      {result ? (
        <div className="hub-install-result">
          {result.installed.length > 0 && (
            <div className="hub-install-result-row hub-install-result-success">
              <Check size={14} />
              {t("install.result_installed", { count: result.installed.length })}
            </div>
          )}
          {result.skipped.length > 0 && (
            <div className="hub-install-result-row hub-install-result-skipped">
              <AlertTriangle size={14} />
              {t("install.result_skipped", { count: result.skipped.length })}
            </div>
          )}
          {result.errors.length > 0 && (
            <div className="hub-install-result-row hub-install-result-error">
              <AlertTriangle size={14} />
              {t("install.result_errors", { count: result.errors.length })}
            </div>
          )}
          <button type="button" className="hub-install-close-btn" onClick={onClose}>
            {t("common:close")}
          </button>
        </div>
      ) : loading ? (
        <div className="hub-install-loading">
          <Loader2 size={20} className="hub-spinner" />
        </div>
      ) : (
        <>
          <div className="hub-install-title">{t("install.select_agent")}</div>
          {agents.length === 0 ? (
            <div className="hub-install-empty">{t("share.no_agents")}</div>
          ) : (
            <div className="hub-install-agent-list">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  role="menuitem"
                  className="hub-install-agent-item"
                  onClick={() => handleSelect(agent)}
                >
                  <Bot size={14} />
                  <span>{agent.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
