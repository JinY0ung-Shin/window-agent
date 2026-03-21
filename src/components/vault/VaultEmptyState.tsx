import { useTranslation } from "react-i18next";
import { BookOpen } from "lucide-react";
import EmptyState from "../common/EmptyState";

export default function VaultEmptyState() {
  const { t } = useTranslation("vault");
  return (
    <EmptyState
      icon={<BookOpen size={40} strokeWidth={1.5} />}
      message={t("empty.selectNote")}
      hint={t("empty.createNew")}
      className="vault-empty-state"
    />
  );
}
