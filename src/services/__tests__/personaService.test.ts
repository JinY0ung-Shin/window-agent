import { describe, it, expect, beforeEach } from "vitest";
import * as cmds from "../tauriCommands";
import {
  readPersonaFiles,
  writePersonaFiles,
  invalidatePersonaCache,
  assembleSystemPrompt,
  assembleManagerPrompt,
  getEffectiveSettings,
} from "../personaService";
import { useSettingsStore } from "../../stores/settingsStore";
import { makeAgent, EMPTY_PERSONA } from "../../__tests__/testFactories";

vi.mock("../tauriCommands");
vi.mock("../../stores/settingsStore", () => {
  const { create } = require("zustand");
  const store = create(() => ({
    hasApiKey: true,
    modelName: "global-model",
    thinkingEnabled: true,
    thinkingBudget: 8192,
    isSettingsOpen: false,
  }));
  return { useSettingsStore: store };
});

beforeEach(() => {
  vi.mocked(cmds.readAgentFile).mockReset();
  vi.mocked(cmds.writeAgentFile).mockReset();
  invalidatePersonaCache(); // clear all cache between tests
});

describe("readPersonaFiles", () => {
  it("reads all 4 files", async () => {
    vi.mocked(cmds.readAgentFile).mockResolvedValue("content");

    const result = await readPersonaFiles("test-agent");

    expect(cmds.readAgentFile).toHaveBeenCalledTimes(4);
    expect(cmds.readAgentFile).toHaveBeenCalledWith("test-agent", "IDENTITY.md");
    expect(cmds.readAgentFile).toHaveBeenCalledWith("test-agent", "SOUL.md");
    expect(cmds.readAgentFile).toHaveBeenCalledWith("test-agent", "USER.md");
    expect(cmds.readAgentFile).toHaveBeenCalledWith("test-agent", "AGENTS.md");
    expect(result).toEqual({
      identity: "content",
      soul: "content",
      user: "content",
      agents: "content",
    });
  });

  it("returns empty strings for missing files", async () => {
    vi.mocked(cmds.readAgentFile).mockRejectedValue(new Error("not found"));

    const result = await readPersonaFiles("missing-agent");

    expect(result).toEqual({ identity: "", soul: "", user: "", agents: "" });
  });

  it("caches results on second call", async () => {
    vi.mocked(cmds.readAgentFile).mockResolvedValue("cached");

    await readPersonaFiles("cached-agent");
    await readPersonaFiles("cached-agent");

    // Should only be called 4 times (first call), not 8
    expect(cmds.readAgentFile).toHaveBeenCalledTimes(4);
  });
});

describe("writePersonaFiles", () => {
  it("writes all 4 files", async () => {
    vi.mocked(cmds.writeAgentFile).mockResolvedValue(undefined);
    const files: PersonaFiles = {
      identity: "id",
      soul: "so",
      user: "us",
      agents: "ag",
    };

    await writePersonaFiles("write-agent", files);

    expect(cmds.writeAgentFile).toHaveBeenCalledTimes(4);
    expect(cmds.writeAgentFile).toHaveBeenCalledWith("write-agent", "IDENTITY.md", "id");
    expect(cmds.writeAgentFile).toHaveBeenCalledWith("write-agent", "SOUL.md", "so");
    expect(cmds.writeAgentFile).toHaveBeenCalledWith("write-agent", "USER.md", "us");
    expect(cmds.writeAgentFile).toHaveBeenCalledWith("write-agent", "AGENTS.md", "ag");
  });

  it("updates cache so subsequent read skips IPC", async () => {
    vi.mocked(cmds.writeAgentFile).mockResolvedValue(undefined);
    const files: PersonaFiles = {
      identity: "written-id",
      soul: "written-so",
      user: "written-us",
      agents: "written-ag",
    };

    await writePersonaFiles("cache-agent", files);

    // Now read should use cache, no readAgentFile calls
    const result = await readPersonaFiles("cache-agent");
    expect(cmds.readAgentFile).not.toHaveBeenCalled();
    expect(result).toEqual(files);
  });
});

describe("invalidatePersonaCache", () => {
  it("clears specific folder cache", async () => {
    vi.mocked(cmds.readAgentFile).mockResolvedValue("data");

    await readPersonaFiles("folder-a");
    expect(cmds.readAgentFile).toHaveBeenCalledTimes(4);

    invalidatePersonaCache("folder-a");

    await readPersonaFiles("folder-a");
    // Should be called again (4 more = 8 total)
    expect(cmds.readAgentFile).toHaveBeenCalledTimes(8);
  });

  it("clears all cache when no args", async () => {
    vi.mocked(cmds.readAgentFile).mockResolvedValue("data");

    await readPersonaFiles("folder-x");
    await readPersonaFiles("folder-y");
    expect(cmds.readAgentFile).toHaveBeenCalledTimes(8);

    invalidatePersonaCache();

    await readPersonaFiles("folder-x");
    await readPersonaFiles("folder-y");
    expect(cmds.readAgentFile).toHaveBeenCalledTimes(16);
  });
});

describe("assembleSystemPrompt", () => {
  it("joins non-empty sections with --- separator", () => {
    const files: PersonaFiles = {
      identity: "I am bot",
      soul: "Be kind",
      user: "",
      agents: "Agent list",
    };

    const result = assembleSystemPrompt(files);

    expect(result).toBe(
      "[IDENTITY]\nI am bot\n\n---\n\n[SOUL]\nBe kind\n\n---\n\n[AGENTS]\nAgent list",
    );
  });

  it("skips empty sections", () => {
    const files: PersonaFiles = {
      identity: "Only identity",
      soul: "",
      user: "",
      agents: "",
    };

    const result = assembleSystemPrompt(files);
    expect(result).toBe("[IDENTITY]\nOnly identity");
  });

  it("returns empty string when all empty", () => {
    expect(assembleSystemPrompt(EMPTY_PERSONA)).toBe("");
  });
});

describe("assembleManagerPrompt", () => {
  const baseFiles: PersonaFiles = {
    identity: "Manager",
    soul: "",
    user: "",
    agents: "",
  };

  it("appends agent list section", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Helper", description: "Helps", is_default: false }),
    ];

    const result = assembleManagerPrompt(baseFiles, agents);

    expect(result).toContain("[REGISTERED AGENTS]");
    expect(result).toContain("**Helper**: Helps");
  });

  it("shows no-agents message when no non-default agents", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(baseFiles, agents);

    expect(result).toContain("No registered agents.");
  });

  it("filters out default agents from list", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
      makeAgent({ id: "2", name: "Custom", description: "Custom agent", is_default: false }),
    ];

    const result = assembleManagerPrompt(baseFiles, agents);

    expect(result).not.toContain("**Default**");
    expect(result).toContain("**Custom**: Custom agent");
  });

  it("replaces {{company_name}} with provided companyName", () => {
    const files: PersonaFiles = {
      identity: "{{company_name}}의 매니저입니다. {{company_name}}을 위해 일합니다.",
      soul: "",
      user: "",
      agents: "",
    };
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(files, agents, "Acme Corp");

    expect(result).toContain("Acme Corp의 매니저입니다.");
    expect(result).toContain("Acme Corp을 위해 일합니다.");
    expect(result).not.toContain("{{company_name}}");
  });

  it("falls back to '우리 회사' when companyName is empty string", () => {
    const files: PersonaFiles = {
      identity: "{{company_name}}의 매니저입니다.",
      soul: "",
      user: "",
      agents: "",
    };
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(files, agents, "");

    expect(result).toContain("우리 회사의 매니저입니다.");
    expect(result).not.toContain("{{company_name}}");
  });

  it("falls back to '우리 회사' when companyName is not provided", () => {
    const files: PersonaFiles = {
      identity: "{{company_name}}의 매니저입니다.",
      soul: "",
      user: "",
      agents: "",
    };
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(files, agents);

    expect(result).toContain("우리 회사의 매니저입니다.");
    expect(result).not.toContain("{{company_name}}");
  });

  it("appends [SYSTEM CONTEXT] with enabled tool names", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];
    const toolNames = ["웹 검색", "파일 읽기", "코드 실행"];

    const result = assembleManagerPrompt(baseFiles, agents, "", toolNames);

    expect(result).toContain("[SYSTEM CONTEXT]");
    expect(result).toContain("사용 가능한 도구: 웹 검색, 파일 읽기, 코드 실행");
  });

  it("omits [SYSTEM CONTEXT] when enabledToolNames is empty", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(baseFiles, agents, "", []);

    expect(result).not.toContain("[SYSTEM CONTEXT]");
  });

  it("omits [SYSTEM CONTEXT] when enabledToolNames is not provided", () => {
    const agents: Agent[] = [
      makeAgent({ id: "1", name: "Default", is_default: true }),
    ];

    const result = assembleManagerPrompt(baseFiles, agents);

    expect(result).not.toContain("[SYSTEM CONTEXT]");
  });
});

describe("getEffectiveSettings", () => {
  it("uses agent model when set", () => {
    const agent = makeAgent({ model: "agent-model" });
    const result = getEffectiveSettings(agent);
    expect(result.model).toBe("agent-model");
  });

  it("falls back to global settings when agent model is null", () => {
    const agent = makeAgent({ model: null });
    const result = getEffectiveSettings(agent);
    expect(result.model).toBe("global-model");
  });

  it("falls back thinking to global", () => {
    const agent = makeAgent({ thinking_enabled: null });
    const result = getEffectiveSettings(agent);
    expect(result.thinkingEnabled).toBe(true); // global default
  });
});
