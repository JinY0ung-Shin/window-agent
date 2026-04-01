import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  CheckCircle2,
  XCircle,
  Loader2,
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
  const shareMode = useHubStore((s) => s.shareMode);
  const shareAgentId = useHubStore((s) => s.shareAgentId);
  const shareFolderName = useHubStore((s) => s.shareFolderName);
  const shareAgentName = useHubStore((s) => s.shareAgentName);
  const shareAgentDesc = useHubStore((s) => s.shareAgentDesc);
  const shareLoading = useHubStore((s) => s.shareLoading);
  const shareError = useHubStore((s) => s.shareError);
  const shareResult = useHubStore((s) => s.shareResult);
  const shareStep = useHubStore((s) => s.shareStep);

  const localSkills = useHubStore((s) => s.localSkills);
  const localNotes = useHubStore((s) => s.localNotes);
  const selectedSkillNames = useHubStore((s) => s.selectedSkillNames);
  const selectedNoteIds = useHubStore((s) => s.selectedNoteIds);

  const closeShareDialog = useHubStore((s) => s.closeShareDialog);
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
    if (!shareDialogOpen || !shareFolderName) return;
    if (shareMode === "skill") {
      loadLocalContent(shareFolderName, "");
    } else if (shareAgentId) {
      loadLocalContent(shareFolderName, shareAgentId);
    }
  }, [shareDialogOpen, shareMode, shareAgentId, shareFolderName, loadLocalContent]);

  if (!shareDialogOpen) return null;

  const isSkillMode = shareMode === "skill";
  const isResult = shareStep === "result";
  const modalTitle = isSkillMode ? t("share.title_skill") : t("share.title");

  const allSkillsSelected = localSkills.length > 0 && selectedSkillNames.size === localSkills.length;
  const allNotesSelected = localNotes.length > 0 && selectedNoteIds.size === localNotes.length;

  const canExecute = isSkillMode
    ? selectedSkillNames.size > 0
    : shareAgentName.trim().length > 0;

  return (
    <Modal
      title={
        <span className="hub-share-modal-title">
          <Upload size={18} />
          {isResult ? (shareResult?.success ? t("share.success") : t("share.error")) : modalTitle}
        </span>
      }
      onClose={closeShareDialog}
      overlayClose="currentTarget"
      contentClassName="hub-share-dialog"
      error={shareError}
      footer={
        isResult ? (
          <button className="btn-primary" onClick={closeShareDialog}>
            {t("share.close")}
          </button>
        ) : (
          <div className="hub-share-footer">
            <div className="hub-share-footer-right">
              <button
                className="btn-primary"
                onClick={executeShare}
                disabled={shareLoading || !canExecute}
              >
                {shareLoading ? (
                  <Loader2 size={14} className="hub-spinner" />
                ) : (
                  <Upload size={14} />
                )}
                {t("share.execute")}
              </button>
            </div>
          </div>
        )
      }
    >
      {isResult && shareResult ? (
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
      ) : (
        <div className="hub-share-step">
          {/* Agent info (agent mode only) */}
          {!isSkillMode && (
            <div className="hub-share-section">
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
                  rows={2}
                  {...descInput.compositionProps}
                />
              </label>
            </div>
          )}

          {/* Skills */}
          {localSkills.length > 0 && (
            <div className="hub-share-section">
              <div className="hub-share-section-header">
                <Wrench size={14} />
                <span>{t("share.step_skills")}</span>
                <label className="hub-share-checkbox hub-share-toggle-all">
                  <input
                    type="checkbox"
                    checked={allSkillsSelected}
                    onChange={(e) => toggleAllSkills(e.target.checked)}
                  />
                  {allSkillsSelected ? t("share.deselect_all") : t("share.select_all")}
                </label>
              </div>
              <div className="hub-share-list">
                {localSkills.map((skill) => (
                  <label key={skill.name} className="hub-share-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedSkillNames.has(skill.name)}
                      onChange={() => toggleSkillSelection(skill.name)}
                    />
                    <span className="hub-share-item-name">{skill.name}</span>
                    {skill.description && (
                      <span className="hub-share-item-desc">— {skill.description}</span>
                    )}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Notes (agent mode only) */}
          {!isSkillMode && localNotes.length > 0 && (
            <div className="hub-share-section">
              <div className="hub-share-section-header">
                <BookOpen size={14} />
                <span>{t("share.step_notes")}</span>
                <label className="hub-share-checkbox hub-share-toggle-all">
                  <input
                    type="checkbox"
                    checked={allNotesSelected}
                    onChange={(e) => toggleAllNotes(e.target.checked)}
                  />
                  {allNotesSelected ? t("share.deselect_all") : t("share.select_all")}
                </label>
              </div>
              <div className="hub-share-list">
                {localNotes.map((note) => (
                  <label key={note.id} className="hub-share-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedNoteIds.has(note.id)}
                      onChange={() => toggleNoteSelection(note.id)}
                    />
                    <span className="hub-share-item-name">{note.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Empty states */}
          {localSkills.length === 0 && (isSkillMode || localNotes.length === 0) && (
            <p className="text-muted">{isSkillMode ? t("share.no_skills") : t("share.no_content")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
