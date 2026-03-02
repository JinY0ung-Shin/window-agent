import { useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useHrStore } from "../../stores/hrStore";
import type { PermissionLevel } from "../../services/types";
import { AppIcon } from "../ui/AppIcon";

const permissionTypes = [
  { id: "file_read", label: "파일 읽기" },
  { id: "file_write", label: "파일 쓰기" },
  { id: "shell_execute", label: "셸 실행" },
  { id: "browser", label: "브라우저" },
  { id: "network", label: "네트워크" },
];

const permissionLevels: { value: PermissionLevel; label: string }[] = [
  { value: "none", label: "차단" },
  { value: "ask", label: "확인" },
  { value: "auto", label: "자동" },
];

export function PermissionSettings() {
  const {
    permissions,
    selectedAgentId,
    loading,
    setSelectedAgentId,
    fetchPermissions,
    updatePermission,
  } = useSettingsStore();
  const { agents, fetchAgents } = useHrStore();

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (selectedAgentId) {
      fetchPermissions(selectedAgentId);
    }
  }, [selectedAgentId, fetchPermissions]);

  const getPermissionLevel = (permissionType: string): PermissionLevel => {
    const perm = permissions.find((p) => p.permissionType === permissionType);
    return perm?.level || "none";
  };

  const handleLevelChange = (permissionType: string, level: PermissionLevel) => {
    if (!selectedAgentId) return;
    updatePermission(selectedAgentId, permissionType, level);
  };

  const activeAgents = agents.filter((a) => a.isActive);

  return (
    <div className="surface-card p-5 animate-slideUp">
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        권한 설정
      </h2>

      <div className="mb-4">
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          에이전트 선택
        </label>
        <select
          value={selectedAgentId || ""}
          onChange={(e) => setSelectedAgentId(e.target.value || null)}
          className="w-full bg-surface-700/30 border border-white/[0.06] rounded-xl px-3 py-2.5 text-sm text-text-primary placeholder-text-muted backdrop-blur-sm focus:outline-none focus:border-accent-500/40 focus:shadow-[0_0_12px_rgba(124,58,237,0.08)] transition-all duration-200"
        >
          <option value="">에이전트를 선택하세요</option>
          {activeAgents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.name} - {agent.role}
            </option>
          ))}
        </select>
      </div>

      {selectedAgentId && (
        <div className="rounded-xl border border-white/[0.06] bg-surface-700/25 backdrop-blur-sm overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-text-muted text-sm">
              로딩 중...
            </div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/[0.06]">
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                    권한 유형
                  </th>
                  {permissionLevels.map((level) => (
                    <th
                      key={level.value}
                      className="px-4 py-3 text-center text-xs font-medium text-text-muted uppercase tracking-wider"
                    >
                      {level.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissionTypes.map((perm) => {
                  const currentLevel = getPermissionLevel(perm.id);
                  return (
                    <tr
                      key={perm.id}
                      className="border-b border-white/[0.04] transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 text-sm text-text-primary">
                        {perm.label}
                      </td>
                      {permissionLevels.map((level) => (
                        <td
                          key={level.value}
                          className="px-4 py-3 text-center"
                        >
                          <button
                            onClick={() =>
                              handleLevelChange(perm.id, level.value)
                            }
                            className={`w-8 h-8 rounded-xl text-xs font-medium transition-all duration-200 ${currentLevel === level.value
                                ? level.value === "none"
                                  ? "bg-red-500/15 text-red-400 shadow-[0_0_8px_rgba(248,113,113,0.15)]"
                                  : level.value === "ask"
                                    ? "bg-yellow-500/15 text-yellow-400 shadow-[0_0_8px_rgba(251,191,36,0.15)]"
                                    : "bg-green-500/15 text-green-400 shadow-[0_0_8px_rgba(52,211,153,0.15)]"
                                : "bg-surface-700/50 text-text-muted hover:bg-surface-600/50"
                              }`}
                          >
                            {currentLevel === level.value ? "●" : "○"}
                          </button>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {!selectedAgentId && (
        <div className="text-center py-12 flex flex-col items-center gap-2 animate-fadeIn">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-500/15 to-surface-700/70 text-text-muted shadow-[0_0_16px_rgba(124,58,237,0.08)]">
            <AppIcon name="shield" size={18} />
          </span>
          <p className="text-sm text-text-muted">에이전트를 선택하여 권한을 관리하세요.</p>
        </div>
      )}
    </div>
  );
}
