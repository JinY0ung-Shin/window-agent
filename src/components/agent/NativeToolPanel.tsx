import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { ToolConfig, NativeToolDef, ToolPermissionTier } from "../../services/types";
import { getNativeTools } from "../../services/nativeToolRegistry";
import ToggleSwitch from "../common/ToggleSwitch";

const TIER_COLOR: Record<ToolPermissionTier, string> = {
  auto: "#22c55e",
  confirm: "#f59e0b",
  deny: "#ef4444",
};

const TIER_LABEL_KEY: Record<ToolPermissionTier, string> = {
  auto: "tools.tierAuto",
  confirm: "tools.tierConfirm",
  deny: "tools.tierDeny",
};

interface Props {
  folderName: string;
  toolConfig: ToolConfig | null;
  onChange: (config: ToolConfig) => void;
}

export default function NativeToolPanel({ folderName: _folderName, toolConfig, onChange }: Props) {
  const { t } = useTranslation("agent");
  const [nativeTools, setNativeTools] = useState<NativeToolDef[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getNativeTools()
      .then(setNativeTools)
      .catch(() => setNativeTools([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="native-tool-panel"><span className="native-tool-loading">{t("tools.loading")}</span></div>;
  }

  if (!toolConfig || nativeTools.length === 0) {
    return (
      <div className="native-tool-panel">
        <div className="native-tool-empty">{t("tools.noNativeTools")}</div>
      </div>
    );
  }

  // Group by category
  const groups = new Map<string, NativeToolDef[]>();
  for (const tool of nativeTools) {
    const cat = tool.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat)!.push(tool);
  }

  const categoryLabel = (category: string): string => {
    const keyMap: Record<string, string> = {
      file: "tools.categoryFile",
      web: "tools.categoryWeb",
      memory: "tools.categoryMemory",
      browser: "tools.categoryBrowser",
      self: "tools.categorySelf",
      system: "tools.categorySystem",
    };
    return keyMap[category] ? t(keyMap[category]) : category;
  };

  const toggleTool = (toolName: string, enabled: boolean) => {
    const entry = toolConfig.native[toolName];
    const tool = nativeTools.find((t) => t.name === toolName);
    const tier = entry?.tier ?? tool?.default_tier ?? "confirm";
    onChange({
      ...toolConfig,
      native: {
        ...toolConfig.native,
        [toolName]: { enabled, tier },
      },
    });
  };

  const setTier = (toolName: string, tier: ToolPermissionTier) => {
    const entry = toolConfig.native[toolName];
    if (!entry) return;
    onChange({
      ...toolConfig,
      native: {
        ...toolConfig.native,
        [toolName]: { ...entry, tier },
      },
    });
  };

  const toggleCategory = (category: string, enabled: boolean) => {
    const tools = groups.get(category);
    if (!tools) return;
    const updated = { ...toolConfig.native };
    for (const tool of tools) {
      const entry = updated[tool.name];
      updated[tool.name] = { enabled, tier: entry?.tier ?? tool.default_tier };
    }
    onChange({ ...toolConfig, native: updated });
  };

  const isCategoryAllEnabled = (category: string): boolean => {
    const tools = groups.get(category);
    if (!tools) return false;
    return tools.every((t) => toolConfig.native[t.name]?.enabled);
  };

  const toggleAutoApprove = (enabled: boolean) => {
    onChange({ ...toolConfig, auto_approve: enabled });
  };

  return (
    <div className="native-tool-panel">
      <div className="native-tool-auto-approve">
        <div className="toggle-row">
          <label id="native-tool-auto-approve-label">{t("credentials.autoApproveTools")}</label>
          <ToggleSwitch
            checked={toolConfig.auto_approve ?? false}
            onChange={toggleAutoApprove}
            ariaLabelledby="native-tool-auto-approve-label"
          />
        </div>
        <p className="form-text">{t("credentials.autoApproveToolsDesc")}</p>
      </div>

      {Array.from(groups.entries()).map(([category, tools]) => {
        const allEnabled = isCategoryAllEnabled(category);
        return (
          <div key={category} className="native-tool-group">
            <div className="native-tool-group-header">
              <input
                type="checkbox"
                checked={allEnabled}
                onChange={(e) => toggleCategory(category, e.target.checked)}
                aria-label={`${t("tools.selectAll")} — ${categoryLabel(category)}`}
              />
              <span>{categoryLabel(category)}</span>
              <span className="native-tool-group-count">{tools.length}</span>
            </div>
            {tools.map((tool) => {
              const entry = toolConfig.native[tool.name];
              const enabled = entry?.enabled ?? false;
              const tier = entry?.tier ?? tool.default_tier;
              return (
                <div key={tool.name} className={`native-tool-row ${enabled ? "" : "disabled"}`}>
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => toggleTool(tool.name, e.target.checked)}
                    aria-label={t("tools.toggleTool", { name: tool.name })}
                  />
                  <div className="native-tool-meta">
                    <span className="native-tool-name">{tool.name}</span>
                    <span className="native-tool-desc">{tool.description}</span>
                  </div>
                  <select
                    className="native-tool-tier"
                    value={tier}
                    disabled={!enabled}
                    onChange={(e) => setTier(tool.name, e.target.value as ToolPermissionTier)}
                    style={enabled ? { color: TIER_COLOR[tier] } : undefined}
                    aria-label={t("tools.tierLabel", { name: tool.name })}
                  >
                    {(Object.keys(TIER_LABEL_KEY) as ToolPermissionTier[]).map((tierKey) => (
                      <option key={tierKey} value={tierKey}>{t(TIER_LABEL_KEY[tierKey])}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
