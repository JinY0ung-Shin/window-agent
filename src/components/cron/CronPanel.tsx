import { useEffect, useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Clock, Plus, Trash2, Settings, Bot, ChevronDown, ChevronRight } from "lucide-react";
import { useCronStore } from "../../stores/cronStore";
import { useAgentStore } from "../../stores/agentStore";
import CronEditor from "./CronEditor";
import type { CronJob, CronRun } from "../../services/types";
import { logger } from "../../services/logger";
import DraggableHeader from "../layout/DraggableHeader";
import EmptyState from "../common/EmptyState";

function formatSchedule(job: CronJob): string {
  switch (job.schedule_type) {
    case "at":
      return new Date(job.schedule_value).toLocaleString();
    case "every": {
      const secs = parseInt(job.schedule_value, 10);
      if (secs >= 86400) return `${Math.floor(secs / 86400)}d`;
      if (secs >= 3600) return `${Math.floor(secs / 3600)}h`;
      if (secs >= 60) return `${Math.floor(secs / 60)}m`;
      return `${secs}s`;
    }
    case "cron":
      return job.schedule_value;
    default:
      return job.schedule_value;
  }
}

function JobCard({ job }: { job: CronJob }) {
  const { t } = useTranslation("cron");
  const deleteJob = useCronStore((s) => s.deleteJob);
  const toggleJob = useCronStore((s) => s.toggleJob);
  const openEditor = useCronStore((s) => s.openEditor);

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showRuns, setShowRuns] = useState(false);
  const [runs, setRuns] = useState<CronRun[]>([]);

  const handleToggleRuns = async () => {
    if (!showRuns) {
      try {
        const r = await import("../../services/commands/cronCommands").then(
          (m) => m.listCronRuns(job.id, 5),
        );
        setRuns(r);
      } catch (e) {
        logger.error("Failed to load runs:", e);
      }
    }
    setShowRuns(!showRuns);
  };

  const statusKey = job.claimed_at
    ? "running"
    : job.last_result ?? "idle";

  return (
    <div className={`cron-card${!job.enabled ? " cron-card-disabled" : ""}`}>
      <div className="cron-card-header">
        <div className="cron-card-name">{job.name}</div>
        <div className="cron-card-actions" onClick={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <div className="cron-card-delete-confirm">
              <button className="btn-danger-sm" onClick={() => { deleteJob(job.id); setConfirmDelete(false); }}>
                {t("common:delete")}
              </button>
              <button className="btn-secondary-sm" onClick={() => setConfirmDelete(false)}>
                {t("cancel")}
              </button>
            </div>
          ) : (
            <>
              <button className="cron-card-edit" onClick={() => openEditor(job.id)} title={t("editJob")}>
                <Settings size={14} />
              </button>
              <button className="cron-card-delete" onClick={() => setConfirmDelete(true)} title={t("deleteConfirm")}>
                <Trash2 size={14} />
              </button>
            </>
          )}
        </div>
      </div>

      {job.description && <div className="cron-card-desc">{job.description}</div>}

      <div className="cron-card-schedule">
        <span className="cron-card-schedule-badge">{t(`types.${job.schedule_type}`)}</span>
        <span>{formatSchedule(job)}</span>
      </div>

      <div className="cron-card-footer">
        <div className="cron-card-status">
          <span className={`cron-status-dot ${statusKey}`} />
          <span>{t(`status.${statusKey}`)}</span>
          {job.run_count > 0 && <span>· {t("runCount", { count: job.run_count })}</span>}
        </div>
        <div className="cron-card-toggle" onClick={(e) => e.stopPropagation()}>
          <button
            className={`cron-toggle-switch${job.enabled ? " active" : ""}`}
            onClick={() => toggleJob(job.id, !job.enabled)}
            title={job.enabled ? t("enabled") : t("disabled")}
          />
        </div>
      </div>

      {job.next_run_at && (
        <div className="cron-card-schedule" style={{ fontSize: "0.75rem" }}>
          <span>{t("nextRun")}:</span>
          <span>{new Date(job.next_run_at).toLocaleString()}</span>
        </div>
      )}

      {job.run_count > 0 && (
        <>
          <button className="cron-card-runs-toggle" onClick={handleToggleRuns}>
            {showRuns ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t("runHistory")}
          </button>
          {showRuns && (
            <div className="cron-card-runs">
              {runs.length === 0 ? (
                <div className="cron-no-runs">{t("noRuns")}</div>
              ) : (
                runs.map((run) => (
                  <div key={run.id} className="cron-run-item">
                    <span className={`cron-status-dot ${run.status}`} />
                    <span className="cron-run-time">
                      {new Date(run.started_at).toLocaleString()}
                    </span>
                    <span className="cron-run-summary">
                      {run.error ?? run.result_summary ?? ""}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CronPanel() {
  const { t } = useTranslation("cron");
  const jobs = useCronStore((s) => s.jobs);
  const loadJobs = useCronStore((s) => s.loadJobs);
  const isEditorOpen = useCronStore((s) => s.isEditorOpen);
  const openEditor = useCronStore((s) => s.openEditor);
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);

  useEffect(() => {
    loadJobs();
    loadAgents();
  }, [loadJobs, loadAgents]);

  // Group jobs by agent
  const groupedJobs = useMemo(() => {
    const map = new Map<string, CronJob[]>();
    for (const job of jobs) {
      const list = map.get(job.agent_id) ?? [];
      list.push(job);
      map.set(job.agent_id, list);
    }
    return map;
  }, [jobs]);

  const getAgent = (agentId: string) => agents.find((a) => a.id === agentId);

  return (
    <div className="cron-panel">
      <DraggableHeader className="cron-panel-header">
        <div className="cron-panel-title">
          <Clock size={22} />
          <h2>{t("title")}</h2>
        </div>
        <button className="btn-primary cron-create-btn" onClick={() => openEditor()}>
          <Plus size={16} />
          {t("newJob")}
        </button>
      </DraggableHeader>

      <div className="cron-panel-body">
        {jobs.length === 0 ? (
          <EmptyState
            icon={<Clock size={48} strokeWidth={1} />}
            message={t("noJobs")}
            className="cron-empty"
          />
        ) : (
          Array.from(groupedJobs.entries()).map(([agentId, agentJobs]) => {
            const agent = getAgent(agentId);
            return (
              <div key={agentId} className="cron-agent-group">
                <div className="cron-agent-group-header">
                  {agent?.avatar ? (
                    <img src={agent.avatar} alt="" className="cron-agent-group-avatar" />
                  ) : (
                    <Bot size={18} />
                  )}
                  <span>{agent?.name ?? "Unknown"}</span>
                </div>
                <div className="cron-grid">
                  {agentJobs.map((job) => (
                    <JobCard key={job.id} job={job} />
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {isEditorOpen && <CronEditor />}
    </div>
  );
}
