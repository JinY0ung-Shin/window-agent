import { useEffect, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Search,
  Users,
  Wrench,
  Package,
  LogIn,
  LogOut,
  Upload,
  Bot,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { useHubStore, PAGE_SIZE } from "../../stores/hubStore";
import { useAgentStore } from "../../stores/agentStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";
import HubAuthForm from "./HubAuthForm";
import HubAgentList from "./HubAgentList";
import HubAgentDetail from "./HubAgentDetail";
import HubSkillList from "./HubSkillList";
import HubMyShares from "./HubMyShares";

const TAB_ICONS = {
  agents: Users,
  skills: Wrench,
  mine: Package,
} as const;

export default function HubPanel() {
  const { t } = useTranslation(["hub", "common"]);

  const loggedIn = useHubStore((s) => s.loggedIn);
  const displayName = useHubStore((s) => s.displayName);
  const activeTab = useHubStore((s) => s.activeTab);
  const searchQuery = useHubStore((s) => s.searchQuery);
  const selectedAgentId = useHubStore((s) => s.selectedAgentId);
  const error = useHubStore((s) => s.error);
  const clearError = useHubStore((s) => s.clearError);

  const agentsTotal = useHubStore((s) => s.agentsTotal);
  const agentsOffset = useHubStore((s) => s.agentsOffset);
  const skillsTotal = useHubStore((s) => s.skillsTotal);
  const skillsOffset = useHubStore((s) => s.skillsOffset);
  const initialize = useHubStore((s) => s.initialize);
  const logout = useHubStore((s) => s.logout);
  const setActiveTab = useHubStore((s) => s.setActiveTab);
  const setSearchQuery = useHubStore((s) => s.setSearchQuery);
  const loadAgents = useHubStore((s) => s.loadAgents);
  const loadSkills = useHubStore((s) => s.loadSkills);

  const agents = useAgentStore((s) => s.agents);
  const openShareDialog = useHubStore((s) => s.openShareDialog);
  const openShareSkillDialog = useHubStore((s) => s.openShareSkillDialog);
  const [sharePickerOpen, setSharePickerOpen] = useState(false);
  const [sharePickerMode, setSharePickerMode] = useState<"agent" | "skill">("agent");
  const sharePickerRef = useRef<HTMLDivElement>(null);
  const sharePickerTriggerRef = useRef<HTMLButtonElement>(null);

  const [localQuery, setLocalQuery] = useState("");
  const searchInput = useCompositionInput(setLocalQuery);

  // Close share picker on outside click or Escape (returning focus to the trigger)
  useEffect(() => {
    if (!sharePickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (sharePickerRef.current && !sharePickerRef.current.contains(e.target as Node)) {
        setSharePickerOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSharePickerOpen(false);
        sharePickerTriggerRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [sharePickerOpen]);

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
    // "mine" tab loads its own data via HubMyShares
  }, [loggedIn, activeTab, searchQuery, loadAgents, loadSkills]);

  // Pagination helpers
  const currentTotal =
    activeTab === "agents"
      ? agentsTotal
      : activeTab === "skills"
        ? skillsTotal
        : 0;
  const currentOffset =
    activeTab === "agents"
      ? agentsOffset
      : activeTab === "skills"
        ? skillsOffset
        : 0;
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
      }
    },
    [activeTab, loadAgents, loadSkills],
  );

  const showPagination = !selectedAgentId && activeTab !== "mine" && totalPages > 1;
  const showSearch = activeTab !== "mine";

  return (
    <div className="hub-panel">
      <DraggableHeader className="hub-header">
        <div className="hub-header-title">
          <Globe size={20} />
          <h2>{t("title")}</h2>
        </div>
        {loggedIn ? (
          <div className="hub-header-actions">
            <div className="hub-share-picker-wrapper" ref={sharePickerRef}>
              <button
                ref={sharePickerTriggerRef}
                type="button"
                className="btn-primary btn-sm"
                onClick={() => setSharePickerOpen(!sharePickerOpen)}
                title={t("share.button")}
                aria-haspopup="menu"
                aria-expanded={sharePickerOpen}
              >
                <Upload size={14} />
                {t("share.button")}
              </button>
              {sharePickerOpen && (
                <div className="hub-share-picker-dropdown" role="menu">
                  <div className="hub-share-picker-tabs">
                    <button
                      type="button"
                      className={`hub-share-picker-tab${sharePickerMode === "agent" ? " hub-share-picker-tab--active" : ""}`}
                      onClick={() => setSharePickerMode("agent")}
                    >
                      <Bot size={14} />
                      {t("share.mode_agent")}
                    </button>
                    <button
                      type="button"
                      className={`hub-share-picker-tab${sharePickerMode === "skill" ? " hub-share-picker-tab--active" : ""}`}
                      onClick={() => setSharePickerMode("skill")}
                    >
                      <Wrench size={14} />
                      {t("share.mode_skill")}
                    </button>
                  </div>
                  <div className="hub-share-picker-title">
                    {sharePickerMode === "agent" ? t("share.pick_agent") : t("share.pick_skill_source")}
                  </div>
                  {agents.length === 0 ? (
                    <div className="hub-share-picker-empty">{t("share.no_agents")}</div>
                  ) : (
                    agents.map((agent) => (
                      <button
                        key={agent.id}
                        type="button"
                        role="menuitem"
                        className="hub-share-picker-item"
                        onClick={() => {
                          setSharePickerOpen(false);
                          if (sharePickerMode === "agent") {
                            openShareDialog(agent.id, agent.folder_name, agent.name, agent.description);
                          } else {
                            openShareSkillDialog(agent.folder_name);
                          }
                        }}
                      >
                        {agent.avatar ? (
                          <img src={agent.avatar} alt={agent.name} className="hub-share-picker-avatar" />
                        ) : (
                          <Bot size={16} />
                        )}
                        <span>{agent.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
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
            <LogIn size={16} className="hub-header-login-icon" aria-hidden="true" />
          </div>
        )}
      </DraggableHeader>

      {error && (
        <div className="hub-error" role="alert">
          <span className="hub-error-text">{error}</span>
          <button
            type="button"
            className="icon-btn icon-btn-sm hub-error-dismiss"
            onClick={clearError}
            title={t("common:close")}
            aria-label={t("common:close")}
          >
            <X size={14} />
          </button>
        </div>
      )}

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
          {showSearch && (
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
          )}

          {/* Tab bar */}
          {!selectedAgentId && (
            <div className="hub-tab-bar" role="tablist">
              {(["agents", "skills", "mine"] as const).map((tab) => {
                const Icon = TAB_ICONS[tab];
                const selected = activeTab === tab;
                return (
                  <button
                    key={tab}
                    type="button"
                    role="tab"
                    id={`hub-tab-${tab}`}
                    aria-selected={selected}
                    aria-controls="hub-tabpanel"
                    className={`hub-tab${selected ? " hub-tab--active" : ""}`}
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
          <div
            className="hub-content"
            {...(!selectedAgentId
              ? { role: "tabpanel" as const, id: "hub-tabpanel", "aria-labelledby": `hub-tab-${activeTab}` }
              : {})}
          >
            {selectedAgentId ? (
              <HubAgentDetail />
            ) : activeTab === "agents" ? (
              <HubAgentList />
            ) : activeTab === "skills" ? (
              <HubSkillList />
            ) : (
              <HubMyShares />
            )}
          </div>

          {/* Pagination */}
          {showPagination && (
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
