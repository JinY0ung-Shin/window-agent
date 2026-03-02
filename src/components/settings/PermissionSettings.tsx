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
    <div className="bg-surface-800 border border-white/[0.06] rounded-2xl shadow-lg p-5">
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
          className="w-full bg-surface-700/40 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 transition-colors"
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
        <div className="bg-surface-700/40 rounded-xl overflow-hidden">
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
                      className="border-b border-white/[0.04]"
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
                            className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                              currentLevel === level.value
                                ? level.value === "none"
                                  ? "bg-red-500/20 text-red-400"
                                  : level.value === "ask"
                                    ? "bg-yellow-500/20 text-yellow-400"
                                    : "bg-green-500/20 text-green-400"
                                : "bg-surface-700 text-text-muted hover:bg-surface-600"
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
        <div className="text-center py-12 flex flex-col items-center gap-2">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-surface-700/70 text-text-muted">
            <AppIcon name="shield" size={16} />
          </span>
          <p className="text-sm text-text-muted">에이전트를 선택하여 권한을 관리하세요.</p>
        </div>
      )}
    </div>
  );
}
