import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../common/Modal";
import { useCronStore } from "../../stores/cronStore";
import { useAgentStore } from "../../stores/agentStore";
import type { CronScheduleType } from "../../services/types";
import { getCronJob } from "../../services/commands/cronCommands";
import { logger } from "../../services/logger";
import { toErrorMessage } from "../../utils/errorUtils";

const INTERVAL_UNITS = [
  { key: "seconds", factor: 1 },
  { key: "minutes", factor: 60 },
  { key: "hours", factor: 3600 },
  { key: "days", factor: 86400 },
] as const;

export default function CronEditor() {
  const { t } = useTranslation("cron");
  const editingJobId = useCronStore((s) => s.editingJobId);
  const closeEditor = useCronStore((s) => s.closeEditor);
  const createJob = useCronStore((s) => s.createJob);
  const updateJob = useCronStore((s) => s.updateJob);
  const agents = useAgentStore((s) => s.agents);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState("");
  const [scheduleType, setScheduleType] = useState<CronScheduleType>("every");
  const [atValue, setAtValue] = useState("");
  const [everyAmount, setEveryAmount] = useState("5");
  const [everyUnit, setEveryUnit] = useState<string>("minutes");
  const [cronExpr, setCronExpr] = useState("");
  const [prompt, setPrompt] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const isEditing = !!editingJobId;

  useEffect(() => {
    if (editingJobId) {
      getCronJob(editingJobId)
        .then((job) => {
          setName(job.name);
          setDescription(job.description);
          setAgentId(job.agent_id);
          setScheduleType(job.schedule_type);
          setEnabled(job.enabled);
          setPrompt(job.prompt);

          if (job.schedule_type === "at") {
            // Convert UTC to local datetime-local format
            const d = new Date(job.schedule_value);
            const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
              .toISOString()
              .slice(0, 16);
            setAtValue(local);
          } else if (job.schedule_type === "every") {
            const secs = parseInt(job.schedule_value, 10);
            if (secs >= 86400 && secs % 86400 === 0) {
              setEveryAmount(String(secs / 86400));
              setEveryUnit("days");
            } else if (secs >= 3600 && secs % 3600 === 0) {
              setEveryAmount(String(secs / 3600));
              setEveryUnit("hours");
            } else if (secs >= 60 && secs % 60 === 0) {
              setEveryAmount(String(secs / 60));
              setEveryUnit("minutes");
            } else {
              setEveryAmount(String(secs));
              setEveryUnit("seconds");
            }
          } else {
            setCronExpr(job.schedule_value);
          }
        })
        .catch((e) => logger.debug("Failed to load job for editing", e));
    }
  }, [editingJobId]);

  const validate = (): boolean => {
    const errs: Record<string, string> = {};

    if (!name.trim()) errs.name = t("validation.nameRequired");
    if (!agentId) errs.agent = t("validation.agentRequired");
    if (!prompt.trim()) errs.prompt = t("validation.promptRequired");

    if (scheduleType === "at") {
      if (!atValue) {
        errs.schedule = t("validation.scheduleRequired");
      } else if (new Date(atValue).getTime() <= Date.now()) {
        errs.schedule = t("validation.pastTimestamp");
      }
    } else if (scheduleType === "every") {
      const totalSecs = parseInt(everyAmount, 10) * (INTERVAL_UNITS.find((u) => u.key === everyUnit)?.factor ?? 1);
      if (!everyAmount || isNaN(totalSecs)) {
        errs.schedule = t("validation.scheduleRequired");
      } else if (totalSecs < 60) {
        errs.schedule = t("validation.minInterval");
      }
    } else if (scheduleType === "cron") {
      if (!cronExpr.trim()) {
        errs.schedule = t("validation.scheduleRequired");
      }
      // Deeper cron validation is done server-side
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const getScheduleValue = (): string => {
    if (scheduleType === "at") {
      return new Date(atValue).toISOString();
    }
    if (scheduleType === "every") {
      const factor = INTERVAL_UNITS.find((u) => u.key === everyUnit)?.factor ?? 1;
      return String(parseInt(everyAmount, 10) * factor);
    }
    return cronExpr.trim();
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);

    try {
      const scheduleValue = getScheduleValue();
      if (isEditing && editingJobId) {
        await updateJob(editingJobId, {
          name: name.trim(),
          description: description.trim(),
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          prompt: prompt.trim(),
          enabled,
        });
      } else {
        await createJob({
          agent_id: agentId,
          name: name.trim(),
          description: description.trim() || undefined,
          schedule_type: scheduleType,
          schedule_value: scheduleValue,
          prompt: prompt.trim(),
          enabled,
        });
      }
      closeEditor();
    } catch (e) {
      logger.error("Failed to save cron job:", e);
      setSaveError(toErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      onClose={closeEditor}
      title={isEditing ? t("editJob") : t("createJob")}
      overlayClose="currentTarget"
      contentClassName="cron-editor-modal"
      error={saveError}
      footer={
        <>
          <button className="btn-secondary" onClick={closeEditor}>
            {t("cancel")}
          </button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {t("save")}
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="form-group">
          <label htmlFor="cronName">{t("jobName")}</label>
          <input
            id="cronName"
            type="text"
            placeholder={t("jobNamePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          {errors.name && <div className="cron-validation-error">{errors.name}</div>}
        </div>

        <div className="form-group">
          <label htmlFor="cronDesc">{t("description")}</label>
          <input
            id="cronDesc"
            type="text"
            placeholder={t("descriptionPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="cronAgent">{t("agent")}</label>
          <select
            id="cronAgent"
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            disabled={isEditing}
          >
            <option value="">{t("selectAgent")}</option>
            {agents.map((agent) => (
              <option key={agent.id} value={agent.id}>
                {agent.name}
              </option>
            ))}
          </select>
          {errors.agent && <div className="cron-validation-error">{errors.agent}</div>}
        </div>

        <div className="form-group">
          <label>{t("scheduleType")}</label>
          <select
            value={scheduleType}
            onChange={(e) => setScheduleType(e.target.value as CronScheduleType)}
          >
            <option value="at">{t("types.at")}</option>
            <option value="every">{t("types.every")}</option>
            <option value="cron">{t("types.cron")}</option>
          </select>
        </div>

        <div className="form-group">
          <label>{t("scheduleValue")}</label>
          {scheduleType === "at" && (
            <input
              type="datetime-local"
              value={atValue}
              onChange={(e) => setAtValue(e.target.value)}
            />
          )}
          {scheduleType === "every" && (
            <div className="cron-schedule-row">
              <div className="form-group">
                <input
                  type="number"
                  min="1"
                  value={everyAmount}
                  onChange={(e) => setEveryAmount(e.target.value)}
                />
              </div>
              <div className="form-group">
                <select value={everyUnit} onChange={(e) => setEveryUnit(e.target.value)}>
                  {INTERVAL_UNITS.map((u) => (
                    <option key={u.key} value={u.key}>
                      {t(`units.${u.key}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {scheduleType === "cron" && (
            <input
              type="text"
              placeholder={t("cronPlaceholder")}
              value={cronExpr}
              onChange={(e) => setCronExpr(e.target.value)}
            />
          )}
          {errors.schedule && <div className="cron-validation-error">{errors.schedule}</div>}
        </div>

        <div className="form-group">
          <label htmlFor="cronPrompt">{t("prompt")}</label>
          <textarea
            id="cronPrompt"
            className="cron-prompt-textarea"
            placeholder={t("promptPlaceholder")}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          {errors.prompt && <div className="cron-validation-error">{errors.prompt}</div>}
        </div>

        <div className="cron-toggle-group">
          <span className="cron-toggle-label">{t("enabled")}</span>
          <button
            className={`cron-toggle-switch${enabled ? " active" : ""}`}
            onClick={() => setEnabled(!enabled)}
          />
        </div>
      </div>
    </Modal>
  );
}
