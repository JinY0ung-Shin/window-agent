import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Upload,
  Wrench,
  BookOpen,
} from "lucide-react";
import Modal from "../common/Modal";
import { useHubStore } from "../../stores/hubStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";

export default function HubShareDialog() {
  const { t } = useTranslation("hub");

  const shareDialogOpen = useHubStore((s) => s.shareDialogOpen);
  const shareStep = useHubStore((s) => s.shareStep);
  const shareAgentId = useHubStore((s) => s.shareAgentId);
  const shareFolderName = useHubStore((s) => s.shareFolderName);
  const shareAgentName = useHubStore((s) => s.shareAgentName);
  const shareAgentDesc = useHubStore((s) => s.shareAgentDesc);
  const shareLoading = useHubStore((s) => s.shareLoading);
  const shareError = useHubStore((s) => s.shareError);
  const shareResult = useHubStore((s) => s.shareResult);

  const localSkills = useHubStore((s) => s.localSkills);
  const localNotes = useHubStore((s) => s.localNotes);
  const selectedSkillNames = useHubStore((s) => s.selectedSkillNames);
  const selectedNoteIds = useHubStore((s) => s.selectedNoteIds);

  const closeShareDialog = useHubStore((s) => s.closeShareDialog);
  const setShareStep = useHubStore((s) => s.setShareStep);
  const setShareAgentName = useHubStore((s) => s.setShareAgentName);
  const setShareAgentDesc = useHubStore((s) => s.setShareAgentDesc);
  const loadLocalContent = useHubStore((s) => s.loadLocalContent);
  const toggleSkillSelection = useHubStore((s) => s.toggleSkillSelection);
  const toggleNoteSelection = useHubStore((s) => s.toggleNoteSelection);
  const toggleAllSkills = useHubStore((s) => s.toggleAllSkills);
  const toggleAllNotes = useHubStore((s) => s.toggleAllNotes);
  const executeShare = useHubStore((s) => s.executeShare);

  const nameInput = useCompositionInput(setShareAgentName);
  const descInput = useCompositionInput(setShareAgentDesc);

  useEffect(() => {
    if (shareDialogOpen && shareAgentId && shareFolderName) {
      loadLocalContent(shareFolderName, shareAgentId);
    }
  }, [shareDialogOpen, shareAgentId, shareFolderName, loadLocalContent]);

  if (!shareDialogOpen) return null;

  const stepTitle = {
    info: t("share.step_info"),
    skills: t("share.step_skills"),
    notes: t("share.step_notes"),
    result: shareResult?.success ? t("share.success") : t("share.error"),
  }[shareStep];

  const allSkillsSelected = localSkills.length > 0 && selectedSkillNames.size === localSkills.length;
  const allNotesSelected = localNotes.length > 0 && selectedNoteIds.size === localNotes.length;

  return (
    <Modal
      title={
        <span className="hub-share-modal-title">
          <Upload size={18} />
          {t("share.title")} — {stepTitle}
        </span>
      }
      onClose={closeShareDialog}
      overlayClose="currentTarget"
      contentClassName="hub-share-dialog"
      error={shareError}
      footer={
        shareStep === "result" ? (
          <button className="btn-primary" onClick={closeShareDialog}>
            {t("share.close")}
          </button>
        ) : (
          <div className="hub-share-footer">
            {shareStep !== "info" && (
              <button
                className="btn-secondary"
                onClick={() =>
                  setShareStep(shareStep === "notes" ? "skills" : "info")
                }
                disabled={shareLoading}
              >
                <ChevronLeft size={14} />
                {t("share.prev")}
              </button>
            )}
            <div className="hub-share-footer-right">
              {shareStep === "info" && (
                <button
                  className="btn-primary"
                  onClick={() => setShareStep("skills")}
                  disabled={!shareAgentName.trim()}
                >
                  {t("share.next")}
                  <ChevronRight size={14} />
                </button>
              )}
              {shareStep === "skills" && (
                <button
                  className="btn-primary"
                  onClick={() => setShareStep("notes")}
                >
                  {t("share.next")}
                  <ChevronRight size={14} />
                </button>
              )}
              {shareStep === "notes" && (
                <button
                  className="btn-primary"
                  onClick={executeShare}
                  disabled={shareLoading}
                >
                  {shareLoading ? (
                    <Loader2 size={14} className="hub-spinner" />
                  ) : (
                    <Upload size={14} />
                  )}
                  {t("share.execute")}
                </button>
              )}
            </div>
          </div>
        )
      }
    >
      {/* Step 1: Agent Info */}
      {shareStep === "info" && (
        <div className="hub-share-step">
          <label className="hub-share-label">
            {t("share.name")}
            <input
              type="text"
              className="hub-share-input"
              value={shareAgentName}
              {...nameInput.compositionProps}
            />
          </label>
          <label className="hub-share-label">
            {t("share.description")}
            <textarea
              className="hub-share-textarea"
              value={shareAgentDesc}
              rows={3}
              {...descInput.compositionProps}
            />
          </label>
        </div>
      )}

      {/* Step 2: Skill Selection */}
      {shareStep === "skills" && (
        <div className="hub-share-step">
          {localSkills.length === 0 ? (
            <p className="text-muted">{t("share.no_skills")}</p>
          ) : (
            <>
              <label className="hub-share-checkbox hub-share-toggle-all">
                <input
                  type="checkbox"
                  checked={allSkillsSelected}
                  onChange={(e) => toggleAllSkills(e.target.checked)}
                />
                {allSkillsSelected ? t("share.deselect_all") : t("share.select_all")}
              </label>
              <div className="hub-share-list">
                {localSkills.map((skill) => (
                  <label key={skill.name} className="hub-share-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedSkillNames.has(skill.name)}
                      onChange={() => toggleSkillSelection(skill.name)}
                    />
                    <Wrench size={14} />
                    <span className="hub-share-item-name">{skill.name}</span>
                    {skill.description && (
                      <span className="hub-share-item-desc">— {skill.description}</span>
                    )}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Note Selection */}
      {shareStep === "notes" && (
        <div className="hub-share-step">
          {localNotes.length === 0 ? (
            <p className="text-muted">{t("share.no_notes")}</p>
          ) : (
            <>
              <label className="hub-share-checkbox hub-share-toggle-all">
                <input
                  type="checkbox"
                  checked={allNotesSelected}
                  onChange={(e) => toggleAllNotes(e.target.checked)}
                />
                {allNotesSelected ? t("share.deselect_all") : t("share.select_all")}
              </label>
              <div className="hub-share-list">
                {localNotes.map((note) => (
                  <label key={note.id} className="hub-share-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedNoteIds.has(note.id)}
                      onChange={() => toggleNoteSelection(note.id)}
                    />
                    <BookOpen size={14} />
                    <span className="hub-share-item-name">{note.title}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 4: Result */}
      {shareStep === "result" && shareResult && (
        <div className="hub-share-step hub-share-result">
          {shareResult.success ? (
            <>
              <CheckCircle2 size={48} className="hub-share-result-icon hub-share-result-success" />
              <p>{t("share.success")}</p>
              <div className="hub-share-result-stats">
                {shareResult.skillsShared > 0 && (
                  <span>{t("share.skills_shared", { count: shareResult.skillsShared })}</span>
                )}
                {shareResult.notesShared > 0 && (
                  <span>{t("share.notes_shared", { count: shareResult.notesShared })}</span>
                )}
              </div>
            </>
          ) : (
            <>
              <XCircle size={48} className="hub-share-result-icon hub-share-result-error" />
              <p>{shareResult.error}</p>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
