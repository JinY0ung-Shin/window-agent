import { useTranslation } from "react-i18next";
import { Loader2 } from "lucide-react";

/**
 * Minimal splash shown while the app finishes async initialization.
 * Paints immediately so the window is never blank during startup.
 */
export default function AppLoading() {
  const { t } = useTranslation("common");
  return (
    <div className="app-loading">
      <Loader2 size={32} className="spinning" />
      <span>{t("loading")}</span>
    </div>
  );
}
