import { useState } from "react";
import { PermissionSettings } from "../components/settings/PermissionSettings";
import { FolderWhitelist } from "../components/settings/FolderWhitelist";
import { ProgramWhitelist } from "../components/settings/ProgramWhitelist";
import { CostDashboard } from "../components/settings/CostDashboard";
import { cn } from "../lib/utils";

type SettingsTab = "permissions" | "folders" | "programs" | "costs";

const tabs: { id: SettingsTab; label: string; emoji: string }[] = [
  { id: "permissions", label: "권한 설정", emoji: "🔐" },
  { id: "folders", label: "폴더 관리", emoji: "📂" },
  { id: "programs", label: "프로그램 관리", emoji: "🖥️" },
  { id: "costs", label: "비용 관리", emoji: "💰" },
];

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("permissions");

  return (
    <div className="p-6">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
          ⚙️ 설정
        </h1>
        <p className="text-xs text-text-muted mt-1">에이전트 권한과 보안 설정을 관리하세요</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-surface-800 rounded-xl p-1 w-fit max-w-full overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "px-4 py-2 rounded-lg text-sm transition-all",
              activeTab === tab.id
                ? "bg-accent-500/15 text-accent-400 font-medium"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            {tab.emoji} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === "permissions" && <PermissionSettings />}
      {activeTab === "folders" && <FolderWhitelist />}
      {activeTab === "programs" && <ProgramWhitelist />}
      {activeTab === "costs" && <CostDashboard />}
    </div>
  );
}
