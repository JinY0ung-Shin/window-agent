import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useCompositionInput } from "../../hooks/useCompositionInput";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  HardDrive,
  Loader2,
  Search,
  Check,
  AlertTriangle,
  Package,
} from "lucide-react";
import {
  marketplaceFetchPlugins,
  marketplaceFetchPluginSkills,
  marketplaceInstallSkills,
  localCcPluginsList,
  localCcPluginSkills,
  localCcInstallSkills,
} from "../../services/commands/marketplaceCommands";
import type {
  MarketplacePluginInfo,
  RemoteSkillInfo,
  InstallResult,
  LocalPluginInfo,
} from "../../services/commands/marketplaceCommands";
import { toErrorMessage } from "../../utils/errorUtils";

interface Props {
  folderName: string;
  onClose: () => void;
  onInstalled: () => void;
}

type View = "input" | "plugins" | "skills" | "localPlugins";

export default function MarketplacePanel({ folderName, onClose, onInstalled }: Props) {
  const { t } = useTranslation("agent");

  // URL input
  const [repoUrl, setRepoUrl] = useState("anthropics/claude-plugins-official");
  const urlComposition = useCompositionInput(setRepoUrl);

  // Plugin list
  const [plugins, setPlugins] = useState<MarketplacePluginInfo[]>([]);
  const [filteredPlugins, setFilteredPlugins] = useState<MarketplacePluginInfo[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const handleSearchChange = useCallback((val: string) => {
    setSearchQuery(val);
    // Filtering is done inside handleSearch, but we also need it on direct set
    if (!val.trim()) {
      setFilteredPlugins(plugins);
    } else {
      const lower = val.toLowerCase();
      setFilteredPlugins(
        plugins.filter(
          (p) =>
            p.name.toLowerCase().includes(lower) ||
            p.description.toLowerCase().includes(lower) ||
            (p.category && p.category.toLowerCase().includes(lower)) ||
            p.keywords.some((k) => k.toLowerCase().includes(lower)),
        ),
      );
    }
  }, [plugins]);
  const searchComposition = useCompositionInput(handleSearchChange);

  // Skill list for selected plugin
  const [selectedPlugin, setSelectedPlugin] = useState<MarketplacePluginInfo | null>(null);
  const [skills, setSkills] = useState<RemoteSkillInfo[]>([]);
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());

  // Local CC plugins
  const [localPlugins, setLocalPlugins] = useState<LocalPluginInfo[]>([]);
  const [selectedLocalPlugin, setSelectedLocalPlugin] = useState<LocalPluginInfo | null>(null);

  // UI state
  const [view, setView] = useState<View>("input");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);

  const handleFetchLocalPlugins = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await localCcPluginsList();
      // Only show plugins that have skills
      setLocalPlugins(result.filter((p) => p.skill_count > 0));
      setView("localPlugins");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSelectLocalPlugin = useCallback(async (plugin: LocalPluginInfo) => {
    setSelectedLocalPlugin(plugin);
    setSelectedPlugin(null);
    setSkills([]);
    setSelectedSkills(new Set());
    setInstallResult(null);
    setLoading(true);
    setError("");
    try {
      const result = await localCcPluginSkills(plugin.install_path);
      setSkills(result);
      setSelectedSkills(new Set(result.map((s) => s.name)));
      setView("skills");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleFetchPlugins = useCallback(async () => {
    if (!repoUrl.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await marketplaceFetchPlugins(repoUrl.trim());
      setPlugins(result);
      setFilteredPlugins(result);
      setView("plugins");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [repoUrl]);


  const handleSelectPlugin = useCallback(async (plugin: MarketplacePluginInfo) => {
    setSelectedPlugin(plugin);
    setSkills([]);
    setSelectedSkills(new Set());
    setInstallResult(null);
    setLoading(true);
    setError("");
    try {
      const result = await marketplaceFetchPluginSkills(
        plugin.repo_url,
        plugin.git_ref,
        plugin.subpath,
      );
      setSkills(result);
      // Auto-select all skills
      setSelectedSkills(new Set(result.map((s) => s.name)));
      setView("skills");
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleSkill = useCallback((skillName: string) => {
    setSelectedSkills((prev) => {
      const next = new Set(prev);
      if (next.has(skillName)) next.delete(skillName);
      else next.add(skillName);
      return next;
    });
  }, []);

  const handleInstall = useCallback(async () => {
    if (selectedSkills.size === 0) return;
    if (!selectedPlugin && !selectedLocalPlugin) return;
    setLoading(true);
    setError("");
    setInstallResult(null);
    try {
      const skillsToInstall = skills.filter((s) => selectedSkills.has(s.name));
      let result: InstallResult;
      if (selectedLocalPlugin) {
        result = await localCcInstallSkills(folderName, skillsToInstall);
      } else {
        result = await marketplaceInstallSkills(
          folderName,
          selectedPlugin!.repo_url,
          selectedPlugin!.git_ref,
          skillsToInstall,
        );
      }
      setInstallResult(result);
      if (result.installed.length > 0) {
        onInstalled();
      }
    } catch (e) {
      setError(toErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [selectedPlugin, selectedLocalPlugin, selectedSkills, skills, folderName, onInstalled]);

  const goBackToPlugins = useCallback(() => {
    // If came from local plugins, go back there
    if (selectedLocalPlugin) {
      setView("localPlugins");
      setSelectedLocalPlugin(null);
    } else {
      setView("plugins");
      setSelectedPlugin(null);
    }
    setSkills([]);
    setSelectedSkills(new Set());
    setInstallResult(null);
    setError("");
  }, [selectedLocalPlugin]);

  const goBackToInput = useCallback(() => {
    setView("input");
    setPlugins([]);
    setFilteredPlugins([]);
    setSearchQuery("");
    setSelectedPlugin(null);
    setSelectedLocalPlugin(null);
    setLocalPlugins([]);
    setSkills([]);
    setError("");
    setInstallResult(null);
  }, []);

  return (
    <div className="marketplace-panel">
      {/* Header */}
      <div className="marketplace-header">
        {view !== "input" && (
          <button
            className="btn-icon"
            onClick={view === "skills" ? goBackToPlugins : goBackToInput}
          >
            <ArrowLeft size={16} />
          </button>
        )}
        <span className="marketplace-title">
          {view === "input" && t("marketplace.title")}
          {view === "plugins" && t("marketplace.pluginList")}
          {view === "localPlugins" && t("marketplace.localPlugins")}
          {view === "skills" && (selectedLocalPlugin?.name || selectedPlugin?.name)}
        </span>
        <button className="btn-secondary marketplace-close-btn" onClick={onClose}>
          {t("common:close")}
        </button>
      </div>

      {/* Error */}
      {error && <div className="marketplace-error">{error}</div>}

      {/* URL Input View */}
      {view === "input" && (
        <div className="marketplace-input-view">
          <p className="marketplace-hint">{t("marketplace.hint")}</p>
          <div className="marketplace-url-row">
            <input
              type="text"
              value={repoUrl}
              placeholder="owner/repo or https://github.com/..."
              onKeyDown={(e) => {
                if (urlComposition.isComposing.current) return;
                if (e.key === "Enter") handleFetchPlugins();
              }}
              {...urlComposition.compositionProps}
            />
            <button
              className="btn-primary"
              onClick={handleFetchPlugins}
              disabled={loading || !repoUrl.trim()}
            >
              {loading ? <Loader2 size={14} className="spin" /> : <Search size={14} />}
              {t("marketplace.fetch")}
            </button>
          </div>
          <div className="marketplace-presets">
            <span className="marketplace-presets-label">{t("marketplace.presets")}</span>
            <button
              className="marketplace-preset-btn"
              onClick={() => {
                setRepoUrl("anthropics/claude-plugins-official");
              }}
            >
              claude-plugins-official
            </button>
            <button
              className="marketplace-preset-btn"
              onClick={() => {
                setRepoUrl("anthropics/claude-plugins-community");
              }}
            >
              claude-plugins-community
            </button>
          </div>

          <div className="marketplace-local-section">
            <div className="marketplace-divider">
              <span>{t("marketplace.or")}</span>
            </div>
            <button
              className="btn-secondary marketplace-local-btn"
              onClick={handleFetchLocalPlugins}
              disabled={loading}
            >
              {loading ? <Loader2 size={14} className="spin" /> : <HardDrive size={14} />}
              {t("marketplace.localPluginsButton")}
            </button>
            <p className="marketplace-local-hint">{t("marketplace.localPluginsHint")}</p>
          </div>
        </div>
      )}

      {/* Plugin List View */}
      {view === "plugins" && (
        <div className="marketplace-plugin-view">
          <div className="marketplace-search-row">
            <Search size={14} />
            <input
              type="text"
              value={searchQuery}
              placeholder={t("marketplace.searchPlaceholder")}
              {...searchComposition.compositionProps}
            />
            <span className="marketplace-count">
              {filteredPlugins.length}/{plugins.length}
            </span>
          </div>
          <div className="marketplace-plugin-list">
            {loading && (
              <div className="marketplace-loading">
                <Loader2 size={16} className="spin" /> {t("marketplace.loading")}
              </div>
            )}
            {!loading && filteredPlugins.length === 0 && (
              <div className="marketplace-empty">{t("marketplace.noPlugins")}</div>
            )}
            {filteredPlugins.map((plugin) => (
              <button
                key={plugin.name}
                className="marketplace-plugin-row"
                onClick={() => handleSelectPlugin(plugin)}
              >
                <div className="marketplace-plugin-info">
                  <div className="marketplace-plugin-name">
                    <Package size={14} />
                    {plugin.name}
                    {plugin.version && (
                      <span className="marketplace-plugin-version">v{plugin.version}</span>
                    )}
                  </div>
                  <div className="marketplace-plugin-desc">{plugin.description}</div>
                  <div className="marketplace-plugin-meta">
                    {plugin.category && (
                      <span className="marketplace-tag">{plugin.category}</span>
                    )}
                    {plugin.author && (
                      <span className="marketplace-author">{plugin.author}</span>
                    )}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Local Plugins View */}
      {view === "localPlugins" && (
        <div className="marketplace-plugin-view">
          <div className="marketplace-plugin-list">
            {loading && (
              <div className="marketplace-loading">
                <Loader2 size={16} className="spin" /> {t("marketplace.loading")}
              </div>
            )}
            {!loading && localPlugins.length === 0 && (
              <div className="marketplace-empty">{t("marketplace.noLocalPlugins")}</div>
            )}
            {localPlugins.map((plugin) => (
              <button
                key={`${plugin.name}@${plugin.marketplace}`}
                className="marketplace-plugin-row"
                onClick={() => handleSelectLocalPlugin(plugin)}
              >
                <div className="marketplace-plugin-info">
                  <div className="marketplace-plugin-name">
                    <Package size={14} />
                    {plugin.name}
                    <span className="marketplace-plugin-version">v{plugin.version}</span>
                  </div>
                  <div className="marketplace-plugin-desc">
                    {plugin.marketplace}
                  </div>
                  <div className="marketplace-plugin-meta">
                    <span className="marketplace-tag">
                      {t("marketplace.skillCount", { count: plugin.skill_count })}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Skill Selection View */}
      {view === "skills" && (
        <div className="marketplace-skill-view">
          {selectedPlugin && (
            <div className="marketplace-plugin-detail">
              <p className="marketplace-plugin-detail-desc">{selectedPlugin.description}</p>
              {selectedPlugin.homepage && (
                <a
                  className="marketplace-link"
                  href={selectedPlugin.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} /> {t("marketplace.homepage")}
                </a>
              )}
            </div>
          )}

          {loading && (
            <div className="marketplace-loading">
              <Loader2 size={16} className="spin" /> {t("marketplace.loadingSkills")}
            </div>
          )}

          {!loading && skills.length === 0 && !installResult && (
            <div className="marketplace-empty">{t("marketplace.noSkills")}</div>
          )}

          {!loading && skills.length > 0 && (
            <>
              <div className="marketplace-skill-list">
                {skills.map((skill) => (
                  <label key={skill.name} className="marketplace-skill-row">
                    <input
                      type="checkbox"
                      checked={selectedSkills.has(skill.name)}
                      onChange={() => toggleSkill(skill.name)}
                    />
                    <div className="marketplace-skill-info">
                      <span className="marketplace-skill-name">{skill.name}</span>
                      <span className="marketplace-skill-desc">{skill.description}</span>
                    </div>
                  </label>
                ))}
              </div>

              {!installResult && (
                <button
                  className="btn-primary marketplace-install-btn"
                  onClick={handleInstall}
                  disabled={loading || selectedSkills.size === 0}
                >
                  <Download size={14} />
                  {t("marketplace.install", { count: selectedSkills.size })}
                </button>
              )}
            </>
          )}

          {/* Install Result */}
          {installResult && (
            <div className="marketplace-result">
              {installResult.installed.length > 0 && (
                <div className="marketplace-result-success">
                  <Check size={14} />
                  {t("marketplace.installed", { count: installResult.installed.length })}
                  <ul>
                    {installResult.installed.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {installResult.skipped.length > 0 && (
                <div className="marketplace-result-skip">
                  <AlertTriangle size={14} />
                  {t("marketplace.skipped", { count: installResult.skipped.length })}
                  <ul>
                    {installResult.skipped.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                </div>
              )}
              {installResult.errors.length > 0 && (
                <div className="marketplace-result-error">
                  <AlertTriangle size={14} />
                  {t("marketplace.installErrors")}
                  <ul>
                    {installResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
