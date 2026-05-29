import { useTranslation } from "react-i18next";
import { Wrench, Loader2, Bot, Trash2, Download } from "lucide-react";
import { useState } from "react";
import { useHubStore } from "../../stores/hubStore";
import EmptyState from "../common/EmptyState";
import HubInstallPopover from "./HubInstallPopover";
import type { SharedSkill } from "../../services/commands/hubCommands";

function SkillCard({ skill }: { skill: SharedSkill }) {
  const { t } = useTranslation("hub");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  const userId = useHubStore((s) => s.userId);
  const loggedIn = useHubStore((s) => s.loggedIn);
  const deleteSharedSkill = useHubStore((s) => s.deleteSharedSkill);
  const isOwner = userId === skill.user_id;

  const handleDelete = async () => {
    setDeleting(true);
    const ok = await deleteSharedSkill(skill.id);
    setDeleting(false);
    if (ok) setConfirmDelete(false);
  };

  return (
    <div className="hub-card">
      <div className="hub-card-header">
        <Wrench size={18} className="hub-card-icon" />
        <div className="hub-card-title">{skill.skill_name}</div>
        <div className="hub-card-actions">
          {loggedIn && (
            <div className="hub-install-wrapper">
              <button
                type="button"
                className="hub-card-install"
                onClick={() => setShowInstall(!showInstall)}
                title={t("install.button")}
                aria-label={t("install.button")}
                aria-haspopup="menu"
                aria-expanded={showInstall}
              >
                <Download size={14} />
              </button>
              {showInstall && (
                <HubInstallPopover
                  type="skill"
                  skill={skill}
                  onClose={() => setShowInstall(false)}
                />
              )}
            </div>
          )}
          {isOwner && (
            <>
              {confirmDelete ? (
                <div className="hub-delete-confirm">
                  <button
                    className="btn-danger-sm"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {t("delete.confirm")}
                  </button>
                  <button
                    className="btn-secondary-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    {t("delete.cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="hub-card-delete"
                  onClick={() => setConfirmDelete(true)}
                  title={t("delete.skill")}
                  aria-label={t("delete.skill")}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {skill.description && (
        <div className="hub-card-desc">{skill.description}</div>
      )}
      <div className="hub-card-footer">
        <span className="hub-card-author">{skill.display_name}</span>
        {skill.agent_name && (
          <span className="hub-card-agent">
            <Bot size={12} />
            {skill.agent_name}
          </span>
        )}
      </div>
    </div>
  );
}

export default function HubSkillList() {
  const { t } = useTranslation("hub");
  const skills = useHubStore((s) => s.skills);
  const skillsLoading = useHubStore((s) => s.skillsLoading);

  if (skillsLoading && skills.length === 0) {
    return (
      <div className="hub-loading">
        <Loader2 size={24} className="hub-spinner" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <EmptyState
        icon={<Wrench size={40} strokeWidth={1.5} />}
        message={t("empty.skills")}
        hint={t("empty.skillsHint")}
        className="hub-empty"
      />
    );
  }

  return (
    <div className="hub-card-grid">
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} />
      ))}
    </div>
  );
}
