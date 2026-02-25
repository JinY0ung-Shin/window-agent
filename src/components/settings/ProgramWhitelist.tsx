import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settingsStore";
import { useHrStore } from "../../stores/hrStore";

export function ProgramWhitelist() {
  const {
    programWhitelist,
    selectedAgentId,
    loading,
    setSelectedAgentId,
    fetchProgramWhitelist,
    addProgram,
    removeProgram,
  } = useSettingsStore();
  const { agents, fetchAgents } = useHrStore();

  const [newProgram, setNewProgram] = useState("");

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (selectedAgentId) {
      fetchProgramWhitelist(selectedAgentId);
    }
  }, [selectedAgentId, fetchProgramWhitelist]);

  const handleAdd = async () => {
    if (!selectedAgentId || !newProgram.trim()) return;
    await addProgram(selectedAgentId, newProgram.trim());
    setNewProgram("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAdd();
    }
  };

  const handleRemove = async (programId: string) => {
    if (!selectedAgentId) return;
    await removeProgram(selectedAgentId, programId);
  };

  const activeAgents = agents.filter((a) => a.isActive);

  return (
    <div className="bg-surface-800 border border-white/[0.06] rounded-2xl shadow-lg p-5">
      <h2 className="text-lg font-semibold text-text-primary mb-4">
        프로그램 화이트리스트
      </h2>

      <div className="mb-4">
        <label className="block text-xs font-medium text-text-secondary mb-1.5">
          에이전트 선택
        </label>
        <select
          value={selectedAgentId || ""}
          onChange={(e) => setSelectedAgentId(e.target.value || null)}
          className="w-full bg-surface-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 transition-colors"
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
        <>
          <div className="flex gap-2 mb-4">
            <input
              type="text"
              value={newProgram}
              onChange={(e) => setNewProgram(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="프로그램 이름 입력 (예: code, chrome)"
              className="flex-1 bg-surface-900 border border-white/[0.06] rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-accent-500/50 transition-colors"
            />
            <button
              onClick={handleAdd}
              disabled={!newProgram.trim()}
              className="px-4 py-2 bg-accent-500 hover:bg-accent-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
            >
              추가
            </button>
          </div>

          <div className="bg-surface-700/40 rounded-xl">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-text-muted text-sm">
                로딩 중...
              </div>
            ) : programWhitelist.length > 0 ? (
              <ul className="divide-y divide-white/[0.04]">
                {programWhitelist.map((entry) => (
                  <li
                    key={entry.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-text-muted text-sm">⚙️</span>
                      <span className="text-sm text-text-primary font-mono">
                        {entry.program}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemove(entry.id)}
                      className="text-text-muted hover:text-red-400 transition-colors"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-center py-8 text-text-muted text-sm">
                등록된 프로그램이 없습니다.
              </div>
            )}
          </div>
        </>
      )}

      {!selectedAgentId && (
        <div className="text-center py-8 text-text-muted text-sm">
          에이전트를 선택하여 프로그램 화이트리스트를 관리하세요.
        </div>
      )}
    </div>
  );
}
