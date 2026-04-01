import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, Wrench, BookOpen, Loader2, Trash2, Package } from "lucide-react";
import { useHubStore } from "../../stores/hubStore";
import EmptyState from "../common/EmptyState";
import type { SharedAgent, SharedSkill } from "../../services/commands/hubCommands";

function MyAgentCard({ agent }: { agent: SharedAgent }) {
  const { t } = useTranslation("hub");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteSharedAgent = useHubStore((s) => s.deleteSharedAgent);
  const selectAgent = useHubStore((s) => s.selectAgent);

  return (
    <div className="hub-card" onClick={() => selectAgent(agent.id)}>
      <div className="hub-card-header">
        <Bot size={18} className="hub-card-icon" />
        <div className="hub-card-title">{agent.name}</div>
        <div className="hub-card-actions" onClick={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <div className="hub-delete-confirm">
              <button className="btn-danger-sm" onClick={() => deleteSharedAgent(agent.id)}>
                {t("delete.confirm")}
              </button>
              <button className="btn-secondary-sm" onClick={() => setConfirmDelete(false)}>
                {t("delete.cancel")}
              </button>
            </div>
          ) : (
            <button
              className="hub-card-delete"
              onClick={() => setConfirmDelete(true)}
              title={t("delete.agent")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {agent.description && <div className="hub-card-desc">{agent.description}</div>}
      <div className="hub-card-footer">
        <div className="hub-card-badges">
          <span className="hub-badge"><Wrench size={10} /> {agent.skills_count}</span>
          <span className="hub-badge"><BookOpen size={10} /> {agent.notes_count}</span>
        </div>
      </div>
    </div>
  );
}

function MySkillCard({ skill }: { skill: SharedSkill }) {
  const { t } = useTranslation("hub");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteSharedSkill = useHubStore((s) => s.deleteSharedSkill);

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <Wrench size={18} className="hub-card-icon" />
        <div className="hub-card-title">{skill.skill_name}</div>
        <div className="hub-card-actions">
          {confirmDelete ? (
            <div className="hub-delete-confirm">
              <button className="btn-danger-sm" onClick={() => deleteSharedSkill(skill.id)}>
                {t("delete.confirm")}
              </button>
              <button className="btn-secondary-sm" onClick={() => setConfirmDelete(false)}>
                {t("delete.cancel")}
              </button>
            </div>
          ) : (
            <button
              className="hub-card-delete"
              onClick={() => setConfirmDelete(true)}
              title={t("delete.skill")}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
      {skill.description && <div className="hub-card-desc">{skill.description}</div>}
      <div className="hub-card-footer">
        {skill.agent_name && (
          <span className="hub-card-agent"><Bot size={12} /> {skill.agent_name}</span>
        )}
      </div>
    </div>
  );
}

export default function HubMyShares() {
  const { t } = useTranslation("hub");
  const myAgents = useHubStore((s) => s.myAgents);
  const mySkills = useHubStore((s) => s.mySkills);
  const myAgentsTotal = useHubStore((s) => s.myAgentsTotal);
  const mySkillsTotal = useHubStore((s) => s.mySkillsTotal);
  const myLoading = useHubStore((s) => s.myLoading);
  const loadMyShares = useHubStore((s) => s.loadMyShares);

  useEffect(() => {
    loadMyShares();
  }, [loadMyShares]);

  if (myLoading && myAgents.length === 0 && mySkills.length === 0) {
    return (
      <div className="hub-loading">
        <Loader2 size={24} className="hub-spinner" />
      </div>
    );
  }

  const isEmpty = myAgents.length === 0 && mySkills.length === 0;

  if (isEmpty) {
    return (
      <EmptyState
        icon={<Package size={40} strokeWidth={1.5} />}
        message={t("mine.empty")}
        hint={t("mine.empty_hint")}
        className="hub-empty"
      />
    );
  }

  return (
    <div className="hub-my-shares">
      {myAgents.length > 0 && (
        <div className="hub-my-section">
          <h3 className="hub-my-section-title">
            <Bot size={16} />
            {t("mine.agents_section", { count: myAgentsTotal })}
          </h3>
          <div className="hub-card-grid">
            {myAgents.map((agent) => (
              <MyAgentCard key={agent.id} agent={agent} />
            ))}
          </div>
        </div>
      )}

      {mySkills.length > 0 && (
        <div className="hub-my-section">
          <h3 className="hub-my-section-title">
            <Wrench size={16} />
            {t("mine.skills_section", { count: mySkillsTotal })}
          </h3>
          <div className="hub-card-grid">
            {mySkills.map((skill) => (
              <MySkillCard key={skill.id} skill={skill} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
