import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { X, Bot } from "lucide-react";
import { useTeamStore } from "../../stores/teamStore";
import { useAgentStore } from "../../stores/agentStore";
import type { TeamDetail } from "../../services/types";

export default function TeamEditor() {
  const { t } = useTranslation("team");
  const editingTeamId = useTeamStore((s) => s.editingTeamId);
  const closeTeamEditor = useTeamStore((s) => s.closeTeamEditor);
  const createTeam = useTeamStore((s) => s.createTeam);
  const updateTeam = useTeamStore((s) => s.updateTeam);
  const addMember = useTeamStore((s) => s.addMember);
  const removeMember = useTeamStore((s) => s.removeMember);
  const getTeamDetail = useTeamStore((s) => s.getTeamDetail);
  const agents = useAgentStore((s) => s.agents);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leaderId, setLeaderId] = useState("");
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<TeamDetail | null>(null);

  const isEditing = !!editingTeamId;

  useEffect(() => {
    if (editingTeamId) {
      getTeamDetail(editingTeamId).then((d) => {
        setDetail(d);
        setName(d.team.name);
        setDescription(d.team.description);
        setLeaderId(d.team.leader_agent_id);
        const ids = new Set(
          d.members
            .filter((m) => m.role === "member")
            .map((m) => m.agent_id),
        );
        setMemberIds(ids);
      }).catch(() => {});
    } else {
      setName("");
      setDescription("");
      setLeaderId("");
      setMemberIds(new Set());
      setDetail(null);
    }
  }, [editingTeamId, getTeamDetail]);

  const toggleMember = (agentId: string) => {
    setMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) {
        next.delete(agentId);
      } else {
        next.add(agentId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || !leaderId) return;
    setSaving(true);

    try {
      if (isEditing && editingTeamId) {
        // Update team metadata
        await updateTeam(editingTeamId, {
          name: name.trim(),
          description: description.trim(),
          leader_agent_id: leaderId,
        });

        // Sync members: remove old, add new
        if (detail) {
          const oldMemberIds = new Set(
            detail.members.filter((m) => m.role === "member").map((m) => m.agent_id),
          );
          // Remove members that were deselected
          for (const id of oldMemberIds) {
            if (!memberIds.has(id)) {
              await removeMember(editingTeamId, id);
            }
          }
          // Add new members
          for (const id of memberIds) {
            if (!oldMemberIds.has(id)) {
              await addMember(editingTeamId, id, "member");
            }
          }
        }
      } else {
        await createTeam(
          name.trim(),
          description.trim(),
          leaderId,
          Array.from(memberIds),
        );
      }

      closeTeamEditor();
    } catch (e) {
      console.error("Failed to save team:", e);
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeTeamEditor();
  };

  // Available agents for member selection (excluding leader)
  const memberCandidates = agents.filter((a) => a.id !== leaderId);

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className="modal-content team-editor-modal">
        <div className="modal-header">
          <h2>{isEditing ? t("editTeam") : t("createTeam")}</h2>
          <button className="close-button" onClick={closeTeamEditor}>
            <X size={20} />
          </button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label htmlFor="teamName">{t("teamName")}</label>
            <input
              id="teamName"
              type="text"
              placeholder={t("teamNamePlaceholder")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="teamDesc">{t("description")}</label>
            <input
              id="teamDesc"
              type="text"
              placeholder={t("descriptionPlaceholder")}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="teamLeader">{t("leader")}</label>
            <select
              id="teamLeader"
              value={leaderId}
              onChange={(e) => {
                const newLeader = e.target.value;
                setLeaderId(newLeader);
                // Remove leader from members if selected
                setMemberIds((prev) => {
                  const next = new Set(prev);
                  next.delete(newLeader);
                  return next;
                });
              }}
            >
              <option value="">{t("selectLeader")}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>{t("members")}</label>
            <div className="team-member-list">
              {memberCandidates.length === 0 ? (
                <p className="form-text">{t("selectLeader")}</p>
              ) : (
                memberCandidates.map((agent) => (
                  <label key={agent.id} className="team-member-checkbox">
                    <input
                      type="checkbox"
                      checked={memberIds.has(agent.id)}
                      onChange={() => toggleMember(agent.id)}
                    />
                    {agent.avatar ? (
                      <img src={agent.avatar} alt="" className="team-member-avatar" />
                    ) : (
                      <Bot size={16} />
                    )}
                    <span>{agent.name}</span>
                  </label>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={closeTeamEditor}>
            {t("cancel")}
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || !leaderId || saving}
          >
            {t("save")}
          </button>
        </div>
      </div>
    </div>
  );
}
