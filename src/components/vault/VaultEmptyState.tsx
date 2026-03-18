import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";

export default function VaultEmptyState() {
  const { t } = useTranslation("vault");
  return (
    <div className="vault-empty-state">
      <BookOpen size={40} strokeWidth={1.5} />
      <p>{t("empty.selectNote")}</p>
      <p>{t("empty.createNew")}</p>
    </div>
  );
}
