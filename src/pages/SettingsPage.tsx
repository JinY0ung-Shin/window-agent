import { useState } from "react";
import { PermissionSettings } from "../components/settings/PermissionSettings";
import { FolderWhitelist } from "../components/settings/FolderWhitelist";
import { ProgramWhitelist } from "../components/settings/ProgramWhitelist";
import { CostDashboard } from "../components/settings/CostDashboard";
import { cn } from "../lib/utils";
import { PageHeader } from "../components/ui/PageHeader";
import { PageShell } from "../components/ui/PageShell";
import { AppIcon, type AppIconName } from "../components/ui/AppIcon";

type SettingsTab = "permissions" | "folders" | "programs" | "costs";

const tabs: { id: SettingsTab; label: string; icon: AppIconName }[] = [
  { id: "permissions", label: "권한 설정", icon: "shield" },
  { id: "folders", label: "폴더 관리", icon: "folder" },
  { id: "programs", label: "프로그램 관리", icon: "monitor" },
  { id: "costs", label: "비용 관리", icon: "money" },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("permissions");

  return (
    <PageShell>
      <PageHeader
        icon="settings"
        title="설정"
        description="권한 정책, 허용 목록, 비용 운영 설정을 관리합니다."
      />

      <div className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[0.06] bg-surface-700/30 p-1 backdrop-blur-sm">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-all duration-200",
                active
                  ? "bg-gradient-to-r from-accent-500/18 to-cyan-500/8 text-text-primary shadow-[0_0_10px_rgba(124,58,237,0.08)]"
                  : "text-text-secondary hover:text-text-primary hover:bg-white/[0.04]"
              )}
            >
              <AppIcon name={tab.icon} size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {activeTab === "permissions" && <PermissionSettings />}
      {activeTab === "folders" && <FolderWhitelist />}
      {activeTab === "programs" && <ProgramWhitelist />}
      {activeTab === "costs" && <CostDashboard />}
    </PageShell>
  );
}
