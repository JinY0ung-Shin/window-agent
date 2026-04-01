import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, LogIn, UserPlus } from "lucide-react";
import { useHubStore } from "../../stores/hubStore";
import { useCompositionInput } from "../../hooks/useCompositionInput";

export default function HubAuthForm() {
  const { t } = useTranslation("hub");
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const authLoading = useHubStore((s) => s.authLoading);
  const authError = useHubStore((s) => s.authError);
  const login = useHubStore((s) => s.login);
  const register = useHubStore((s) => s.register);

  const emailInput = useCompositionInput(setEmail);
  const displayNameInput = useCompositionInput(setDisplayName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isRegister) {
      const ok = await register(email, password, displayName || undefined);
      if (ok) {
        setEmail("");
        setPassword("");
        setDisplayName("");
      }
    } else {
      const ok = await login(email, password);
      if (ok) {
        setEmail("");
        setPassword("");
      }
    }
  };

  return (
    <form className="hub-auth-form" onSubmit={handleSubmit}>
      <div className="hub-auth-toggle">
        <button
          type="button"
          className={`hub-auth-toggle-btn${!isRegister ? " active" : ""}`}
          onClick={() => setIsRegister(false)}
        >
          <LogIn size={14} />
          {t("auth.login")}
        </button>
        <button
          type="button"
          className={`hub-auth-toggle-btn${isRegister ? " active" : ""}`}
          onClick={() => setIsRegister(true)}
        >
          <UserPlus size={14} />
          {t("auth.register")}
        </button>
      </div>

      <div className="hub-auth-fields">
        <div className="form-group">
          <label>{t("auth.email")}</label>
          <input
            type="email"
            value={email}
            placeholder={t("auth.emailPlaceholder")}
            required
            disabled={authLoading}
            {...emailInput.compositionProps}
          />
        </div>
        <div className="form-group">
          <label>{t("auth.password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.passwordPlaceholder")}
            required
            disabled={authLoading}
          />
        </div>
        {isRegister && (
          <div className="form-group">
            <label>{t("auth.displayName")}</label>
            <input
              type="text"
              value={displayName}
              placeholder={t("auth.displayNamePlaceholder")}
              disabled={authLoading}
              {...displayNameInput.compositionProps}
            />
          </div>
        )}
      </div>

      {authError && <div className="hub-auth-error">{authError}</div>}

      <button
        type="submit"
        className="btn-primary hub-auth-submit"
        disabled={authLoading || !email || !password}
      >
        {authLoading ? (
          <Loader2 size={16} className="hub-spinner" />
        ) : isRegister ? (
          t("auth.registerBtn")
        ) : (
          t("auth.loginBtn")
        )}
      </button>
    </form>
  );
}
