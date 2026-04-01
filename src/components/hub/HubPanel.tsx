import { useEffect, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Search,
  Users,
  Wrench,
  BookOpen,
  LogIn,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useHubStore, PAGE_SIZE } from "../../stores/hubStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";
import HubAuthForm from "./HubAuthForm";
import HubAgentList from "./HubAgentList";
import HubAgentDetail from "./HubAgentDetail";
import HubSkillList from "./HubSkillList";
import HubNoteList from "./HubNoteList";

const TAB_ICONS = {
  agents: Users,
  skills: Wrench,
  notes: BookOpen,
} as const;

export default function HubPanel() {
  const { t } = useTranslation("hub");

  const loggedIn = useHubStore((s) => s.loggedIn);
  const displayName = useHubStore((s) => s.displayName);
  const activeTab = useHubStore((s) => s.activeTab);
  const searchQuery = useHubStore((s) => s.searchQuery);
  const selectedAgentId = useHubStore((s) => s.selectedAgentId);
  const error = useHubStore((s) => s.error);

  const agentsTotal = useHubStore((s) => s.agentsTotal);
  const agentsOffset = useHubStore((s) => s.agentsOffset);
  const skillsTotal = useHubStore((s) => s.skillsTotal);
  const skillsOffset = useHubStore((s) => s.skillsOffset);
  const notesTotal = useHubStore((s) => s.notesTotal);
  const notesOffset = useHubStore((s) => s.notesOffset);

  const initialize = useHubStore((s) => s.initialize);
  const logout = useHubStore((s) => s.logout);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const setSearchQuery = useHubStore((s) => s.setSearchQuery);
  const loadAgents = useHubStore((s) => s.loadAgents);
  const loadSkills = useHubStore((s) => s.loadSkills);
  const loadNotes = useHubStore((s) => s.loadNotes);

  const [localQuery, setLocalQuery] = useState("");
  const searchInput = useCompositionInput(setLocalQuery);

  // Debounce: localQuery -> store searchQuery
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(localQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [localQuery, setSearchQuery]);

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Load data when tab/login/searchQuery changes
  useEffect(() => {
    if (!loggedIn) return;
    if (activeTab === "agents") loadAgents(0);
    else if (activeTab === "skills") loadSkills(0);
    else if (activeTab === "notes") loadNotes(0);
  }, [loggedIn, activeTab, searchQuery, loadAgents, loadSkills, loadNotes]);

  // Pagination helpers
  const currentTotal =
    activeTab === "agents"
      ? agentsTotal
      : activeTab === "skills"
        ? skillsTotal
        : notesTotal;
  const currentOffset =
    activeTab === "agents"
      ? agentsOffset
      : activeTab === "skills"
        ? skillsOffset
        : notesOffset;
  const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
  const currentPage = Math.floor(currentOffset / PAGE_SIZE) + 1;

  const goToPage = useCallback(
    (page: number) => {
      const offset = (page - 1) * PAGE_SIZE;
      switch (activeTab) {
        case "agents":
          loadAgents(offset);
          break;
        case "skills":
          loadSkills(offset);
          break;
        case "notes":
          loadNotes(offset);
          break;
      }
    },
    [activeTab, loadAgents, loadSkills, loadNotes],
  );

  return (
    <div className="hub-panel">
      <DraggableHeader className="hub-header">
        <div className="hub-header-title">
          <Globe size={20} />
          <h2>{t("title")}</h2>
        </div>
        {loggedIn ? (
          <div className="hub-header-actions">
            <span className="hub-header-user">{displayName}</span>
            <button
              className="icon-btn"
              onClick={logout}
              title={t("auth.logout")}
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="hub-header-actions">
            <LogIn size={16} className="hub-header-login-icon" />
          </div>
        )}
      </DraggableHeader>

      {error && <div className="hub-error">{error}</div>}

      {!loggedIn ? (
        <div className="hub-panel-body">
          <EmptyState
            icon={<Globe size={48} strokeWidth={1} />}
            message={t("empty.notLoggedIn")}
            hint={t("empty.notLoggedInHint")}
            className="hub-empty"
          />
          <HubAuthForm />
        </div>
      ) : (
        <div className="hub-panel-body">
          {/* Search bar */}
          <div className="hub-search">
            <Search size={16} className="hub-search-icon" />
            <input
              type="text"
              className="hub-search-input"
              placeholder={t("search.placeholder")}
              value={localQuery}
              {...searchInput.compositionProps}
            />
          </div>

          {/* Tab bar */}
          {!selectedAgentId && (
            <div className="hub-tab-bar">
              {(["agents", "skills", "notes"] as const).map((tab) => {
                const Icon = TAB_ICONS[tab];
                return (
                  <button
                    key={tab}
                    className={`hub-tab${activeTab === tab ? " hub-tab--active" : ""}`}
                    onClick={() => { setActiveTab(tab); setLocalQuery(""); }}
                  >
                    <Icon size={14} />
                    {t(`tabs.${tab}`)}
                  </button>
                );
              })}
            </div>
          )}

          {/* Content */}
          <div className="hub-content">
            {selectedAgentId ? (
              <HubAgentDetail />
            ) : activeTab === "agents" ? (
              <HubAgentList />
            ) : activeTab === "skills" ? (
              <HubSkillList />
            ) : (
              <HubNoteList />
            )}
          </div>

          {/* Pagination */}
          {!selectedAgentId && totalPages > 1 && (
            <div className="hub-pagination">
              <button
                className="hub-pagination-btn"
                disabled={currentPage <= 1}
                onClick={() => goToPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              <span className="hub-pagination-info">
                {t("pagination.page", {
                  current: currentPage,
                  total: totalPages,
                })}
              </span>
              <button
                className="hub-pagination-btn"
                disabled={currentPage >= totalPages}
                onClick={() => goToPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
