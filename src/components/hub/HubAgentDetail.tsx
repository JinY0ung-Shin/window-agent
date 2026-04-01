import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ArrowLeft,
  Bot,
  Wrench,
  BookOpen,
  Loader2,
  Trash2,
  Tag,
  UserPlus,
  Check,
  AlertTriangle,
} from "lucide-react";
import { useHubStore } from "../../stores/hubStore";
import EmptyState from "../common/EmptyState";
import type { SharedSkill, SharedNote } from "../../services/commands/hubCommands";

function SkillItem({ skill }: { skill: SharedSkill }) {
  return (
    <div className="hub-detail-item">
      <div className="hub-detail-item-header">
        <Wrench size={14} />
        <span className="hub-detail-item-name">{skill.skill_name}</span>
      </div>
      {skill.description && (
        <div className="hub-detail-item-desc">{skill.description}</div>
      )}
    </div>
  );
}

function NoteItem({ note }: { note: SharedNote }) {
  return (
    <div className="hub-detail-item">
      <div className="hub-detail-item-header">
        <BookOpen size={14} />
        <span className="hub-detail-item-name">{note.title}</span>
        {note.note_type && (
          <span className="hub-badge-type">{note.note_type}</span>
        )}
      </div>
      {note.tags.length > 0 && (
        <div className="hub-detail-tags">
          {note.tags.map((tag) => (
            <span key={tag} className="hub-tag">
              <Tag size={10} />
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function HubAgentDetail() {
  const { t } = useTranslation("hub");
  const agents = useHubStore((s) => s.agents);
  const myAgents = useHubStore((s) => s.myAgents);
  const selectedAgentId = useHubStore((s) => s.selectedAgentId);
  const agentSkills = useHubStore((s) => s.agentSkills);
  const agentNotes = useHubStore((s) => s.agentNotes);
  const detailLoading = useHubStore((s) => s.detailLoading);
  const clearSelection = useHubStore((s) => s.clearSelection);
  const deleteSharedAgent = useHubStore((s) => s.deleteSharedAgent);
  const hireAgent = useHubStore((s) => s.hireAgent);
  const userId = useHubStore((s) => s.userId);
  const loggedIn = useHubStore((s) => s.loggedIn);

  const [hiring, setHiring] = useState(false);
  const [hireResult, setHireResult] = useState<{ installed: string[]; skipped: string[]; errors: string[] } | null>(null);

  const agent = agents.find((a) => a.id === selectedAgentId)
    ?? myAgents.find((a) => a.id === selectedAgentId);

  if (!agent) {
    return (
      <EmptyState
        icon={<Bot size={40} strokeWidth={1.5} />}
        message={t("error.agentNotFound")}
        className="hub-empty"
      />
    );
  }

  const isOwner = userId === agent.user_id;

  const handleDelete = async () => {
    if (!window.confirm(t("delete.confirm"))) return;
    const ok = await deleteSharedAgent(agent.id);
    if (ok) clearSelection();
  };

  const handleHire = async () => {
    setHiring(true);
    const res = await hireAgent(agent.name, agent.description);
    setHiring(false);
    if (res) setHireResult(res);
  };

  return (
    <div className="hub-agent-detail">
      <div className="hub-detail-header">
        <button className="hub-back-btn" onClick={clearSelection}>
          <ArrowLeft size={18} />
          {t("agent.backToList")}
        </button>
        <div className="hub-detail-actions">
          {loggedIn && (agentSkills.length > 0 || agentNotes.length > 0) && (
            <button
              className="hub-install-all-btn"
              onClick={handleHire}
              disabled={hiring || !!hireResult}
              title={t("install.hire")}
            >
              {hiring ? (
                <Loader2 size={16} className="hub-spinner" />
              ) : hireResult ? (
                <Check size={16} />
              ) : (
                <UserPlus size={16} />
              )}
              {hireResult ? t("install.hire_done") : t("install.hire")}
            </button>
          )}
          {isOwner && (
            <button
              className="hub-delete-btn"
              onClick={handleDelete}
              title={t("delete.agent")}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Hire result */}
      {hireResult && (
        <div className="hub-hire-result">
          {hireResult.installed.length > 0 && (
            <span className="hub-install-result-success">
              <Check size={14} />
              {t("install.result_installed", { count: hireResult.installed.length })}
            </span>
          )}
          {hireResult.skipped.length > 0 && (
            <span className="hub-install-result-skipped">
              <AlertTriangle size={14} />
              {t("install.result_skipped", { count: hireResult.skipped.length })}
            </span>
          )}
          {hireResult.errors.length > 0 && (
            <span className="hub-install-result-error">
              <AlertTriangle size={14} />
              {t("install.result_errors", { count: hireResult.errors.length })}
            </span>
          )}
        </div>
      )}

      <div className="hub-detail-info">
        <div className="hub-detail-name">
          <Bot size={22} />
          {agent.name}
        </div>
        {agent.description && (
          <div className="hub-detail-desc">{agent.description}</div>
        )}
        <div className="hub-detail-author">
          {t("agent.sharedBy", { name: agent.display_name })}
        </div>
      </div>

      {detailLoading ? (
        <div className="hub-loading">
          <Loader2 size={24} className="hub-spinner" />
        </div>
      ) : (
        <>
          <div className="hub-detail-section">
            <h3>
              <Wrench size={16} />
              {t("agent.skills")} ({agentSkills.length})
            </h3>
            {agentSkills.length === 0 ? (
              <p className="text-muted">{t("empty.skills")}</p>
            ) : (
              <div className="hub-detail-list">
                {agentSkills.map((skill) => (
                  <SkillItem key={skill.id} skill={skill} />
                ))}
              </div>
            )}
          </div>

          <div className="hub-detail-section">
            <h3>
              <BookOpen size={16} />
              {t("agent.notes")} ({agentNotes.length})
            </h3>
            {agentNotes.length === 0 ? (
              <p className="text-muted">{t("empty.notes")}</p>
            ) : (
              <div className="hub-detail-list">
                {agentNotes.map((note) => (
                  <NoteItem key={note.id} note={note} />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
