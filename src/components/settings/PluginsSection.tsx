import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Package, Check, AlertTriangle, RefreshCw } from "lucide-react";
import {
  localCcPluginsList,
  localCcPluginSkills,
  skillMatrix,
  skillMatrixApply,
} from "../../services/commands/marketplaceCommands";
import type {
  LocalPluginInfo,
  RemoteSkillInfo,
  AgentBrief,
  SkillAssignment,
  BatchResult,
} from "../../services/commands/marketplaceCommands";
import { toErrorMessage } from "../../utils/errorUtils";

interface Props {
  isOpen: boolean;
}

export default function PluginsSection({ isOpen }: Props) {
  const { t } = useTranslation("settings");

  // Plugin selection
  const [plugins, setPlugins] = useState<LocalPluginInfo[]>([]);
  const [selectedPluginKey, setSelectedPluginKey] = useState("");

  const selectedPlugin = useMemo(
    () => plugins.find((p) => `${p.name}@${p.marketplace}` === selectedPluginKey) ?? null,
    [plugins, selectedPluginKey],
  );

  // Matrix data
  const [skills, setSkills] = useState<RemoteSkillInfo[]>([]);
  const [agents, setAgents] = useState<AgentBrief[]>([]);
  const [installed, setInstalled] = useState<Record<string, Set<string>>>({});
  const [changes, setChanges] = useState<
    Record<string, { add: Set<string>; remove: Set<string> }>
  >({});

  // UI
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<BatchResult | null>(null);
  const [pluginsLoaded, setPluginsLoaded] = useState(false);

  // Load plugins when tab becomes visible (only once)
  useEffect(() => {
    if (!isOpen || pluginsLoaded) return;

    (async () => {
      setLoading(true);
      try {
        const list = await localCcPluginsList();
        const withSkills = list.filter((p) => p.skill_count > 0);
        setPlugins(withSkills);
        if (withSkills.length > 0) {
          setSelectedPluginKey(`${withSkills[0].name}@${withSkills[0].marketplace}`);
        }
        setPluginsLoaded(true);
      } catch (e) {
        setError(toErrorMessage(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, pluginsLoaded]);

  // Load skills + matrix when plugin changes
  useEffect(() => {
    if (!selectedPlugin) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError("");
      setResult(null);
      setChanges({});
      try {
        const skillList = await localCcPluginSkills(selectedPlugin.install_path);
        if (cancelled) return;
        setSkills(skillList);

        const skillNames = skillList.map((s) => s.name);
        const mat = await skillMatrix(skillNames);
        if (cancelled) return;
        setAgents(mat.agents);

        const installedMap: Record<string, Set<string>> = {};
        for (const [name, folders] of Object.entries(mat.matrix)) {
          installedMap[name] = new Set(folders);
        }
        setInstalled(installedMap);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [selectedPlugin]);

  const isChecked = useCallback(
    (skillName: string, folder: string): boolean => {
      const change = changes[skillName];
      const wasInstalled = installed[skillName]?.has(folder) ?? false;
      if (change) {
        if (change.add.has(folder)) return true;
        if (change.remove.has(folder)) return false;
      }
      return wasInstalled;
    },
    [installed, changes],
  );

  const hasChanges = useMemo(
    () => Object.values(changes).some((c) => c.add.size > 0 || c.remove.size > 0),
    [changes],
  );

  const toggle = useCallback(
    (skillName: string, folder: string) => {
      setChanges((prev) => {
        const next = { ...prev };
        const wasInstalled = installed[skillName]?.has(folder) ?? false;
        const entry = next[skillName] ?? {
          add: new Set<string>(),
          remove: new Set<string>(),
        };
        const addSet = new Set(entry.add);
        const removeSet = new Set(entry.remove);

        if (wasInstalled) {
          if (removeSet.has(folder)) {
            removeSet.delete(folder);
          } else {
            removeSet.add(folder);
          }
          addSet.delete(folder);
        } else {
          if (addSet.has(folder)) {
            addSet.delete(folder);
          } else {
            addSet.add(folder);
          }
          removeSet.delete(folder);
        }

        if (addSet.size === 0 && removeSet.size === 0) {
          delete next[skillName];
        } else {
          next[skillName] = { add: addSet, remove: removeSet };
        }
        return next;
      });
    },
    [installed],
  );

  const handleApply = useCallback(async () => {
    if (!hasChanges) return;
    setApplying(true);
    setError("");
    setResult(null);
    try {
      const assignments: SkillAssignment[] = [];
      for (const [skillName, change] of Object.entries(changes)) {
        const skill = skills.find((s) => s.name === skillName);
        if (!skill) continue;
        assignments.push({
          skill_name: skillName,
          source_path: skill.path,
          add_to: [...change.add],
          remove_from: [...change.remove],
        });
      }

      const res = await skillMatrixApply(assignments);
      setResult(res);

      // Refresh matrix
      const skillNames = skills.map((s) => s.name);
      const mat = await skillMatrix(skillNames);
      setAgents(mat.agents);
      const installedMap: Record<string, Set<string>> = {};
      for (const [name, folders] of Object.entries(mat.matrix)) {
        installedMap[name] = new Set(folders);
      }
      setInstalled(installedMap);
      setChanges({});
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setApplying(false);
    }
  }, [changes, hasChanges, skills]);

  if (loading && plugins.length === 0) {
    return (
      <div className="plugins-section">
        <div className="plugins-loading">
          <Loader2 size={16} className="spin" /> {t("plugins.loading")}
        </div>
      </div>
    );
  }

  if (pluginsLoaded && plugins.length === 0) {
    return (
      <div className="plugins-section">
        <p className="plugins-empty">{t("plugins.noPlugins")}</p>
      </div>
    );
  }

  return (
    <div className="plugins-section">
      {/* Plugin selector */}
      <div className="plugins-selector">
        <Package size={16} />
        <select
          value={selectedPluginKey}
          disabled={applying}
          onChange={(e) => setSelectedPluginKey(e.target.value)}
        >
          {plugins.map((p) => {
            const key = `${p.name}@${p.marketplace}`;
            return (
              <option key={key} value={key}>
                {p.name} (v{p.version}) — {p.marketplace}
              </option>
            );
          })}
        </select>
      </div>

      {error && <div className="plugins-error">{error}</div>}

      {/* Matrix */}
      {loading ? (
        <div className="plugins-loading">
          <Loader2 size={16} className="spin" /> {t("plugins.loadingMatrix")}
        </div>
      ) : skills.length > 0 && agents.length > 0 ? (
        <div className="plugins-matrix-wrapper">
          <table className="plugins-matrix">
            <thead>
              <tr>
                <th className="plugins-matrix-skill-header">{t("plugins.skill")}</th>
                {agents.map((a) => (
                  <th key={a.id} className="plugins-matrix-agent-header" title={a.name}>
                    {a.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.name}>
                  <td className="plugins-matrix-skill-cell" title={skill.description}>
                    <span className="plugins-matrix-skill-name">{skill.name}</span>
                  </td>
                  {agents.map((agent) => {
                    const checked = isChecked(skill.name, agent.folder_name);
                    const wasInstalled = installed[skill.name]?.has(agent.folder_name) ?? false;
                    const changed = checked !== wasInstalled;
                    return (
                      <td
                        key={agent.id}
                        className={`plugins-matrix-cell ${changed ? "plugins-matrix-cell-changed" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(skill.name, agent.folder_name)}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="plugins-empty">
          {skills.length === 0
            ? t("plugins.noSkills")
            : t("plugins.noAgents")}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="plugins-result">
          {result.installed.length > 0 && (
            <span className="plugins-result-ok">
              <Check size={14} /> {t("plugins.installed", { count: result.installed.length })}
            </span>
          )}
          {result.removed.length > 0 && (
            <span className="plugins-result-ok">
              <Check size={14} /> {t("plugins.removed", { count: result.removed.length })}
            </span>
          )}
          {result.errors.length > 0 && (
            <span className="plugins-result-err">
              <AlertTriangle size={14} /> {result.errors.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Apply button — only when matrix is visible */}
      {skills.length > 0 && agents.length > 0 && (
        <div className="plugins-actions">
          <button
            className="btn-primary"
            disabled={!hasChanges || applying}
            onClick={handleApply}
          >
            {applying ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            {t("plugins.apply")}
          </button>
        </div>
      )}
    </div>
  );
}
