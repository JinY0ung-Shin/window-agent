import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import { useLoadOnOpen } from "../../hooks/useLoadOnOpen";
import { Plus, Pencil, Trash2, X } from "lucide-react";
import type { CredentialMeta } from "../../services/types";
import {
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
} from "../../services/commands/credentialCommands";
import { toErrorMessage } from "../../utils/errorUtils";

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface FormState {
  mode: "add" | "edit";
  id: string;
  name: string;
  description: string;
  value: string;
  showValue: boolean;
  idEdited: boolean;
}

const EMPTY_FORM: FormState = {
  mode: "add",
  id: "",
  name: "",
  description: "",
  value: "",
  showValue: false,
  idEdited: false,
};

export default function CredentialManager() {
  const { t } = useTranslation("agent");
  const { data: credentials, loading, reload: refresh } = useLoadOnOpen(listCredentials);
  const [form, setForm] = useState<FormState | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM });
    setError(null);
  };

  const openEdit = (cred: CredentialMeta) => {
    setForm({
      mode: "edit",
      id: cred.id,
      name: cred.name,
      description: cred.description ?? "",
      value: "",
      showValue: false,
      idEdited: true,
    });
    setError(null);
  };

  const handleNameChange = useCallback((name: string) => {
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, name, id: prev.idEdited ? prev.id : toSlug(name) };
    });
  }, []);

  const handleIdChange = (id: string) => {
    if (!form) return;
    setForm({ ...form, id, idEdited: true });
  };

  const nameComposition = useCompositionInput(handleNameChange);

  const handleSave = async () => {
    if (!form) return;
    const id = form.id.trim();
    const name = form.name.trim();
    if (!id || !name) return;

    try {
      if (form.mode === "add") {
        if (!form.value) return;
        await addCredential(id, name, form.value, form.description.trim(), []);
      } else {
        await updateCredential(
          id,
          name,
          form.value || undefined,
          form.description.trim(),
          [],
        );
      }
      setForm(null);
      setError(null);
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await removeCredential(id);
      setDeleteConfirm(null);
      await refresh();
    } catch (e) {
      setError(toErrorMessage(e));
    }
  };

  if (loading) {
    return <div className="cred-manager"><span className="cred-loading">{t("tools.loading")}</span></div>;
  }

  return (
    <div className="cred-manager">
      {/* Credential list */}
      {(credentials ?? []).length === 0 && !form && (
        <div className="cred-empty">{t("credentials.noCredentials")}</div>
      )}

      {(credentials ?? []).map((cred) => (
        <div key={cred.id} className="cred-item">
          <div className="cred-item-info">
            <span className="cred-item-name">{cred.name}</span>
            <span className="cred-item-id">{cred.id}</span>
            {cred.description && <span className="cred-item-desc">{cred.description}</span>}
            <span className="cred-item-value">{"••••••"}</span>
          </div>
          <div className="cred-item-actions">
            <button
              className="cred-action-btn"
              onClick={() => openEdit(cred)}
              title={t("credentials.edit")}
            >
              <Pencil size={14} />
            </button>
            {deleteConfirm === cred.id ? (
              <div className="cred-confirm-delete">
                <span>{t("credentials.confirmDelete")}</span>
                <button className="cred-action-btn danger" onClick={() => handleDelete(cred.id)}>
                  {t("common:confirm")}
                </button>
                <button className="cred-action-btn" onClick={() => setDeleteConfirm(null)}>
                  {t("common:cancel")}
                </button>
              </div>
            ) : (
              <button
                className="cred-action-btn danger"
                onClick={() => setDeleteConfirm(cred.id)}
                title={t("credentials.delete")}
              >
                <Trash2 size={14} />
              </button>
            )}
          </div>
        </div>
      ))}

      {/* Add/Edit form */}
      {form ? (
        <div className="cred-form">
          <div className="cred-form-header">
            <span>{form.mode === "add" ? t("credentials.add") : t("credentials.edit")}</span>
            <button className="cred-action-btn" onClick={() => setForm(null)}>
              <X size={14} />
            </button>
          </div>

          <div className="cred-form-field">
            <label>{t("credentials.name")}</label>
            <input
              type="text"
              value={form.name}
              placeholder={t("credentials.namePlaceholder")}
              {...nameComposition.compositionProps}
            />
          </div>

          <div className="cred-form-field">
            <label>{t("credentials.id")}</label>
            <input
              type="text"
              value={form.id}
              onChange={(e) => handleIdChange(e.target.value)}
              disabled={form.mode === "edit"}
              placeholder="github-token"
            />
          </div>

          <div className="cred-form-field">
            <label>{t("credentials.description")}</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t("credentials.descriptionPlaceholder")}
            />
            <span className="cred-form-hint">{t("credentials.descriptionHint")}</span>
          </div>

          <div className="cred-form-field">
            <label>
              {form.mode === "edit" ? t("credentials.changeValue") : t("credentials.value")}
            </label>
            <input
              type="password"
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder={form.mode === "edit" ? t("credentials.valuePlaceholderEdit") : t("credentials.valuePlaceholderNew")}
            />
          </div>

          {error && <div className="cred-form-error">{error}</div>}

          <div className="cred-form-actions">
            <button className="btn-secondary" onClick={() => setForm(null)}>{t("common:cancel")}</button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={!form.name.trim() || !form.id.trim() || (form.mode === "add" && !form.value)}
            >
              {t("common:save")}
            </button>
          </div>
        </div>
      ) : (
        <button className="cred-add-btn" onClick={openAdd}>
          <Plus size={16} />
          {t("credentials.add")}
        </button>
      )}
    </div>
  );
}
