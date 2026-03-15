import { useState, useEffect } from "react";
import {
  parseToolsMd,
  serializeToolsMd,
  canRoundTrip,
  type ToolDefinition,
} from "../../services/toolRegistry";
import ToolStructuredEditor from "./ToolStructuredEditor";
import ToolRawEditor from "./ToolRawEditor";

interface Props {
  rawContent: string;
  onChange: (content: string) => void;
}

export default function ToolManagementPanel({ rawContent, onChange }: Props) {
  const [modeLocked, setModeLocked] = useState(false);
  const [useStructured, setUseStructured] = useState(true);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [rawText, setRawText] = useState(rawContent);

  useEffect(() => {
    setRawText(rawContent);

    if (!modeLocked) {
      const safe = canRoundTrip(rawContent);
      setUseStructured(safe);
      if (rawContent.trim() || modeLocked) {
        setModeLocked(true);
      }
    }

    if (canRoundTrip(rawContent)) {
      setTools(parseToolsMd(rawContent));
    }
  }, [rawContent]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleToolsChange = (updated: ToolDefinition[]) => {
    setTools(updated);
    onChange(serializeToolsMd(updated));
  };

  const handleSwitchToStructured = () => {
    setUseStructured(true);
    setModeLocked(true);
    setTools(parseToolsMd(rawContent));
  };

  const handleRawChange = (value: string) => {
    setRawText(value);
    onChange(value);
  };

  if (!useStructured) {
    return (
      <ToolRawEditor
        rawText={rawText}
        onChange={handleRawChange}
        onSwitchToStructured={handleSwitchToStructured}
      />
    );
  }

  return (
    <ToolStructuredEditor
      tools={tools}
      onToolsChange={handleToolsChange}
    />
  );
}
