import { AlertTriangle } from "lucide-react";

interface Props {
  rawText: string;
  onChange: (value: string) => void;
  onSwitchToStructured: () => void;
}

export default function ToolRawEditor({ rawText, onChange, onSwitchToStructured }: Props) {
  return (
    <div className="tool-mgmt-panel">
      <div className="tool-fallback-warning">
        <AlertTriangle size={14} />
        <span>TOOLS.md에 수동 편집된 내용이 있어 구조화된 편집기를 사용할 수 없습니다.</span>
        <button className="btn-secondary" onClick={onSwitchToStructured}>
          구조화된 편집기로 전환 (내용이 변환됩니다)
        </button>
      </div>
      <textarea
        className="persona-editor"
        value={rawText}
        onChange={(e) => onChange(e.target.value)}
        placeholder="TOOLS.md 마크다운 형식으로 도구를 정의합니다"
        spellCheck={false}
      />
    </div>
  );
}
