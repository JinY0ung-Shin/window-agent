import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Users, Plus, Trash2, Crown, Bot, Settings, MessageSquare } from "lucide-react";
import { useTeamStore } from "../../stores/teamStore";
import { useAgentStore } from "../../stores/agentStore";
import { useConversationStore } from "../../stores/conversationStore";
import { useMessageStore } from "../../stores/messageStore";
import { useNavigationStore } from "../../stores/navigationStore";
import TeamEditor from "./TeamEditor";
import type { TeamDetail } from "../../services/types";
import { logger } from "../../services/logger";

export default function TeamPanel() {
  const { t } = useTranslation("team");
  const teams = useTeamStore((s) => s.teams);
  const loadTeams = useTeamStore((s) => s.loadTeams);
  const deleteTeam = useTeamStore((s) => s.deleteTeam);
  const selectTeam = useTeamStore((s) => s.selectTeam);
  const isTeamEditorOpen = useTeamStore((s) => s.isTeamEditorOpen);
  const openTeamEditor = useTeamStore((s) => s.openTeamEditor);
  const getTeamDetail = useTeamStore((s) => s.getTeamDetail);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const conversations = useConversationStore((s) => s.conversations);
  const selectConversation = useConversationStore((s) => s.selectConversation);
  const setMainView = useNavigationStore((s) => s.setMainView);
  const clearMessages = useMessageStore((s) => s.clearMessages);

  const [teamDetails, setTeamDetails] = useState<Record<string, TeamDetail>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Group team conversations by team_id
  const teamConversationsMap = useMemo(() => {
    const map: Record<string, typeof conversations> = {};
    for (const conv of conversations) {
      if (conv.team_id) {
        if (!map[conv.team_id]) map[conv.team_id] = [];
        map[conv.team_id].push(conv);
      }
    }
    return map;
  }, [conversations]);

  useEffect(() => {
    loadTeams();
    loadAgents();
  }, [loadTeams, loadAgents]);

  // Load details for all teams to get member counts
  useEffect(() => {
    const fetchDetails = async () => {
      const details: Record<string, TeamDetail> = {};
      for (const team of teams) {
        try {
          details[team.id] = await getTeamDetail(team.id);
        } catch (e) { logger.debug(`Failed to load team detail for ${team.id}`, e); }
      }
      setTeamDetails(details);
    };
    if (teams.length > 0) fetchDetails();
  }, [teams, getTeamDetail]);

  const getAgentName = (agentId: string) => {
    return agents.find((a) => a.id === agentId)?.name ?? "Unknown";
  };

  const getAgentAvatar = (agentId: string) => {
    return agents.find((a) => a.id === agentId)?.avatar ?? null;
  };

  const handleDelete = (teamId: string) => {
    deleteTeam(teamId);
    setConfirmDeleteId(null);
  };

  return (
    <div className="team-panel">
      <div className="team-panel-header">
        <div className="team-panel-title">
          <Users size={22} />
          <h2>{t("title")}</h2>
        </div>
        <button className="btn-primary team-create-btn" onClick={() => openTeamEditor()}>
          <Plus size={16} />
          {t("newTeam")}
        </button>
      </div>

      <div className="team-panel-body">
        {teams.length === 0 ? (
          <div className="team-empty">
            <Users size={48} strokeWidth={1} />
            <p>{t("noTeams")}</p>
          </div>
        ) : (
          <div className="team-grid">
            {teams.map((team) => {
              const detail = teamDetails[team.id];
              const memberCount = detail?.members.length ?? 0;
              const leaderAvatar = getAgentAvatar(team.leader_agent_id);

              return (
                <div
                  key={team.id}
                  className="team-card"
                  onClick={() => {
                    clearMessages();
                    selectTeam(team.id);
                  }}
                >
                  <div className="team-card-header">
                    <div className="team-card-name">{team.name}</div>
                    <div className="team-card-actions" onClick={(e) => e.stopPropagation()}>
                      {confirmDeleteId === team.id ? (
                        <div className="team-card-delete-confirm">
                          <button
                            className="btn-danger-sm"
                            onClick={() => handleDelete(team.id)}
                          >
                            {t("common:delete")}
                          </button>
                          <button
                            className="btn-secondary-sm"
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            {t("cancel")}
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            className="team-card-edit"
                            onClick={() => openTeamEditor(team.id)}
                            title={t("editTeam")}
                          >
                            <Settings size={14} />
                          </button>
                          <button
                            className="team-card-delete"
                            onClick={() => setConfirmDeleteId(team.id)}
                            title={t("deleteConfirm")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {team.description && (
                    <div className="team-card-desc">{team.description}</div>
                  )}

                  <div className="team-card-footer">
                    <div className="team-card-leader">
                      <Crown size={14} />
                      {leaderAvatar ? (
                        <img src={leaderAvatar} alt="" className="team-card-avatar" />
                      ) : (
                        <Bot size={14} />
                      )}
                      <span>{getAgentName(team.leader_agent_id)}</span>
                    </div>
                    <div className="team-card-members">
                      <Users size={14} />
                      <span>{t("memberCount", { count: memberCount })}</span>
                    </div>
                  </div>

                  {/* Team conversation list */}
                  {teamConversationsMap[team.id] && teamConversationsMap[team.id].length > 0 && (
                    <div
                      className="team-card-conversations"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {teamConversationsMap[team.id].map((conv) => (
                        <div
                          key={conv.id}
                          className="team-conv-item"
                          onClick={() => {
                            selectTeam(team.id);
                            selectConversation(conv.id);
                            setMainView("team");
                          }}
                        >
                          <MessageSquare size={12} />
                          <span className="team-conv-title">{conv.title}</span>
                          <span className="team-conv-date">
                            {new Date(conv.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {isTeamEditorOpen && <TeamEditor />}
    </div>
  );
}
