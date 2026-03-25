import { forwardRef, useImperativeHandle, useRef } from "react";
import { useTranslation } from "react-i18next";
import ApiServerSection from "./ApiServerSection";
import ProxySection from "./ProxySection";
import NetworkToggleSection from "./NetworkToggleSection";
import RelayConfigSection from "./RelayConfigSection";
import RelayToolsSection from "./RelayToolsSection";
import type { ApiServerSectionRef } from "./ApiServerSection";

export interface NetworkPanelValues {
  apiKey: string;
  clearApiKey: boolean;
  baseUrl: string;
  modelName: string;
}

export interface NetworkSettingsPanelRef {
  getValues: () => NetworkPanelValues;
}

interface Props {
  isOpen: boolean;
}

const NetworkSettingsPanel = forwardRef<NetworkSettingsPanelRef, Props>(
  function NetworkSettingsPanel({ isOpen }, ref) {
    const { t } = useTranslation("settings");
    const apiRef = useRef<ApiServerSectionRef>(null);

    useImperativeHandle(ref, () => ({
      getValues: () => {
        const values = apiRef.current?.getValues();
        return {
          apiKey: values?.apiKey ?? "",
          clearApiKey: values?.clearApiKey ?? false,
          baseUrl: values?.baseUrl ?? "",
          modelName: values?.modelName ?? "",
        };
      },
    }));

    return (
      <>
        <ApiServerSection ref={apiRef} isOpen={isOpen} />
        <ProxySection isOpen={isOpen} />

        <h3 className="settings-section-title">{t("sections.agentNetwork")}</h3>
        <NetworkToggleSection />
        <RelayConfigSection isOpen={isOpen} />
        <RelayToolsSection isOpen={isOpen} />
      </>
    );
  },
);

export default NetworkSettingsPanel;
