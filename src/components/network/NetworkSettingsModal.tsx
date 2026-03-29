import { useTranslation } from "react-i18next";
import Modal from "../common/Modal";
import NetworkToggleSection from "../settings/NetworkToggleSection";
import RelayConfigSection from "../settings/RelayConfigSection";
import RelayToolsSection from "../settings/RelayToolsSection";

interface Props {
  onClose: () => void;
}

export default function NetworkSettingsModal({ onClose }: Props) {
  const { t } = useTranslation("network");

  return (
    <Modal
      title={t("settingsSection.title")}
      onClose={onClose}
      overlayClose="currentTarget"
      contentClassName="network-settings-modal"
    >
      <div className="network-settings-modal-body">
        <NetworkToggleSection />

        <h3 className="settings-section-title">{t("settingsSection.relay")}</h3>
        <RelayConfigSection isOpen />
        <RelayToolsSection isOpen />
      </div>
    </Modal>
  );
}
