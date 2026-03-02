import { useState, useEffect } from "react";
import { useHrStore } from "../../stores/hrStore";
import type { AiBackendType, UpdateAgentRequest } from "../../services/types";
import { Button } from "../ui/Button";
import { ModalShell } from "../ui/ModalShell";

const toolOptions = [
  { id: "file_read", label: "파일 읽기" },
  { id: "file_write", label: "파일 쓰기" },
  { id: "shell_execute", label: "셸 실행" },
  { id: "browser", label: "브라우저" },
  { id: "web_search", label: "웹 검색" },
];

const aiBackends: { value: AiBackendType; label: string }[] = [
  { value: "claude", label: "Claude" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "custom", label: "커스텀" },
];

const inputClass =
  "w-full rounded-lg border border-white/[0.08] bg-surface-900 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-500/50 focus:outline-none";
const labelClass = "mb-1.5 block text-xs font-medium text-text-secondary";

export function AgentEditModal() {
  const { showEditModal, selectedAgent, departments, closeEditModal, updateAgent } =
    useHrStore();

  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [department, setDepartment] = useState("");
  const [personality, setPersonality] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [aiBackend, setAiBackend] = useState<AiBackendType>("claude");
  const [apiUrl, setApiUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [avatar, setAvatar] = useState("");
  const [tools, setTools] = useState<string[]>([]);

  useEffect(() => {
    if (selectedAgent && showEditModal) {
      setName(selectedAgent.name);
      setRole(selectedAgent.role);
      setDepartment(selectedAgent.department);
      setPersonality(selectedAgent.personality);
      setSystemPrompt(selectedAgent.systemPrompt);
      setAiBackend(selectedAgent.aiBackend);
      setApiUrl(selectedAgent.apiUrl || "");
      setApiKey(selectedAgent.apiKey || "");
      setModel(selectedAgent.model);
      setAvatar(selectedAgent.avatar);
      setTools(selectedAgent.tools ? selectedAgent.tools.split(",").filter(Boolean) : []);
    }
  }, [selectedAgent, showEditModal]);

  const handleToolToggle = (toolId: string) => {
    setTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgent) return;

    const request: UpdateAgentRequest = {
      name,
      role,
      department,
      personality,
      systemPrompt,
      tools: tools.join(","),
      model,
      avatar,
      aiBackend,
      ...(aiBackend !== "claude" && apiUrl ? { apiUrl } : {}),
      ...(aiBackend !== "claude" && apiKey ? { apiKey } : {}),
    };
    await updateAgent(selectedAgent.id, request);
    closeEditModal();
  };

  if (!selectedAgent) return null;

  return (
    <ModalShell
      isOpen={showEditModal}
      onClose={closeEditModal}
      title="에이전트 수정"
      size="md"
      bodyClassName="max-h-[80vh]"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>이름</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="에이전트 이름"
              className={inputClass}
              required
            />
          </div>
          <div>
            <label className={labelClass}>아바타 텍스트</label>
            <input
              type="text"
              value={avatar}
              onChange={(e) => setAvatar(e.target.value)}
              placeholder="예: KB"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>역할</label>
          <input
            type="text"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="에이전트 역할"
            className={inputClass}
            required
          />
        </div>

        <div>
          <label className={labelClass}>부서</label>
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className={inputClass}
            required
          >
            <option value="">부서 선택</option>
            {departments.map((dept) => (
              <option key={dept.id} value={dept.name}>
                {dept.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass}>성격</label>
          <textarea
            value={personality}
            onChange={(e) => setPersonality(e.target.value)}
            placeholder="에이전트 성격 설명"
            className={`${inputClass} min-h-[80px] resize-none`}
          />
        </div>

        <div>
          <label className={labelClass}>시스템 프롬프트</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="시스템 프롬프트 입력"
            className={`${inputClass} min-h-[80px] resize-none`}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>AI 백엔드</label>
            <select
              value={aiBackend}
              onChange={(e) => setAiBackend(e.target.value as AiBackendType)}
              className={inputClass}
            >
              {aiBackends.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>모델</label>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="모델명"
              className={inputClass}
            />
          </div>
        </div>

        {aiBackend !== "claude" && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>API URL</label>
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="API 키"
                className={inputClass}
              />
            </div>
          </div>
        )}

        <div>
          <label className={labelClass}>도구</label>
          <div className="flex flex-wrap gap-2">
            {toolOptions.map((tool) => (
              <label key={tool.id} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={tools.includes(tool.id)}
                  onChange={() => handleToolToggle(tool.id)}
                  className="rounded border-white/[0.08] bg-surface-900 text-accent-500 focus:ring-accent-500/50"
                />
                <span className="text-xs text-text-secondary">{tool.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={closeEditModal} type="button">
            취소
          </Button>
          <Button type="submit">저장</Button>
        </div>
      </form>
    </ModalShell>
  );
}
