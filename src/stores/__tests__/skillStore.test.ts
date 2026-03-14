import { describe, it, expect, beforeEach } from "vitest";
import { useSkillStore, SKILL_TOKEN_HARD_CAP } from "../skillStore";
import * as cmds from "../../services/tauriCommands";
import type { SkillMetadata, SkillContent } from "../../services/types";

vi.mock("../../services/tauriCommands");

const mockSkills: SkillMetadata[] = [
  { name: "search", description: "Web search skill", source: "agent", path: "/skills/search", diagnostics: [] },
  { name: "calc", description: "Calculator skill", source: "agent", path: "/skills/calc", diagnostics: [] },
];

const mockSkillContent: SkillContent = {
  metadata: mockSkills[0],
  body: "Search the web for information.",
  raw_content: "---\nname: search\ndescription: Web search skill\n---\nSearch the web for information.",
  resource_files: [],
};

const mockCalcContent: SkillContent = {
  metadata: mockSkills[1],
  body: "Perform calculations.",
  raw_content: "---\nname: calc\ndescription: Calculator skill\n---\nPerform calculations.",
  resource_files: [],
};

const initialState = useSkillStore.getState();

beforeEach(() => {
  useSkillStore.setState(initialState, true);
  vi.resetAllMocks();
});

describe("skillStore", () => {
  it("loadSkills populates availableSkills and builds catalogPrompt", async () => {
    vi.mocked(cmds.listSkills).mockResolvedValue(mockSkills);

    await useSkillStore.getState().loadSkills("test-agent");

    const s = useSkillStore.getState();
    expect(s.availableSkills).toEqual(mockSkills);
    expect(s.catalogPrompt).toContain("[AVAILABLE SKILLS]");
    expect(s.catalogPrompt).toContain("- search: Web search skill");
    expect(s.catalogPrompt).toContain("- calc: Calculator skill");
    expect(s.isLoading).toBe(false);
  });

  it("loadSkills handles errors gracefully", async () => {
    vi.mocked(cmds.listSkills).mockRejectedValue(new Error("fail"));

    await useSkillStore.getState().loadSkills("bad-agent");

    const s = useSkillStore.getState();
    expect(s.availableSkills).toEqual([]);
    expect(s.catalogPrompt).toBe("");
    expect(s.isLoading).toBe(false);
  });

  it("activateSkill adds to active and updates tokens", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);

    const result = await useSkillStore.getState().activateSkill("test-agent", "search");

    expect(result).toBe(true);
    const s = useSkillStore.getState();
    expect(s.activeSkillNames).toEqual(["search"]);
    expect(s.activeSkillBodies["search"]).toBe("Search the web for information.");
    expect(s.activeSkillTokens).toBeGreaterThan(0);
  });

  it("activateSkill duplicate is no-op", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);

    await useSkillStore.getState().activateSkill("test-agent", "search");
    const tokensAfterFirst = useSkillStore.getState().activeSkillTokens;

    const result = await useSkillStore.getState().activateSkill("test-agent", "search");

    expect(result).toBe(true);
    expect(useSkillStore.getState().activeSkillNames).toEqual(["search"]);
    expect(useSkillStore.getState().activeSkillTokens).toBe(tokensAfterFirst);
    // readSkill should only be called once
    expect(cmds.readSkill).toHaveBeenCalledTimes(1);
  });

  it("activateSkill over hard cap is rejected", async () => {
    // Create a skill body that exceeds the hard cap
    const hugeBody = "a".repeat(SKILL_TOKEN_HARD_CAP * 5);
    vi.mocked(cmds.readSkill).mockResolvedValue({
      ...mockSkillContent,
      body: hugeBody,
    });

    const result = await useSkillStore.getState().activateSkill("test-agent", "search");

    expect(result).toBe(false);
    expect(useSkillStore.getState().activeSkillNames).toEqual([]);
  });

  it("activateSkill persists to conversation when convId provided", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    vi.mocked(cmds.updateConversationSkills).mockResolvedValue(undefined);

    await useSkillStore.getState().activateSkill("test-agent", "search", "conv-1");

    expect(cmds.updateConversationSkills).toHaveBeenCalledWith("conv-1", ["search"]);
  });

  it("deactivateSkill removes and updates tokens", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    await useSkillStore.getState().activateSkill("test-agent", "search");

    expect(useSkillStore.getState().activeSkillNames).toEqual(["search"]);

    await useSkillStore.getState().deactivateSkill("search");

    const s = useSkillStore.getState();
    expect(s.activeSkillNames).toEqual([]);
    expect(s.activeSkillBodies).toEqual({});
    expect(s.activeSkillTokens).toBe(0);
  });

  it("deactivateSkill persists to conversation when convId provided", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    vi.mocked(cmds.updateConversationSkills).mockResolvedValue(undefined);
    await useSkillStore.getState().activateSkill("test-agent", "search");

    await useSkillStore.getState().deactivateSkill("search", "conv-1");

    expect(cmds.updateConversationSkills).toHaveBeenCalledWith("conv-1", []);
  });

  it("restoreActiveSkills loads bodies and skips missing", async () => {
    vi.mocked(cmds.readSkill)
      .mockResolvedValueOnce(mockSkillContent)
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce(mockCalcContent);

    await useSkillStore.getState().restoreActiveSkills("test-agent", ["search", "missing", "calc"]);

    const s = useSkillStore.getState();
    expect(s.activeSkillNames).toEqual(["search", "calc"]);
    expect(s.activeSkillBodies["search"]).toBe("Search the web for information.");
    expect(s.activeSkillBodies["calc"]).toBe("Perform calculations.");
  });

  it("restoreActiveSkills stops when over budget", async () => {
    // Need > HARD_CAP tokens. ASCII chars = 0.25 tokens each, so need > 3000*4+1 = 12001 chars
    const hugeBody = "a".repeat(SKILL_TOKEN_HARD_CAP * 4 + 4);
    vi.mocked(cmds.readSkill)
      .mockResolvedValueOnce({ ...mockSkillContent, body: hugeBody })
      .mockResolvedValueOnce(mockCalcContent);

    await useSkillStore.getState().restoreActiveSkills("test-agent", ["search", "calc"]);

    // "search" body exceeds hard cap by itself, so nothing fits
    const s = useSkillStore.getState();
    expect(s.activeSkillNames).toEqual([]);
  });

  it("getSkillsPromptSection returns empty when no skills", () => {
    const result = useSkillStore.getState().getSkillsPromptSection();
    expect(result).toBe("");
  });

  it("getSkillsPromptSection returns catalog only when no active skills", async () => {
    vi.mocked(cmds.listSkills).mockResolvedValue(mockSkills);
    await useSkillStore.getState().loadSkills("test-agent");

    const result = useSkillStore.getState().getSkillsPromptSection();
    expect(result).toContain("[AVAILABLE SKILLS]");
    expect(result).not.toContain("[ACTIVE SKILLS]");
  });

  it("getSkillsPromptSection includes active skill bodies", async () => {
    vi.mocked(cmds.listSkills).mockResolvedValue(mockSkills);
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    await useSkillStore.getState().loadSkills("test-agent");
    await useSkillStore.getState().activateSkill("test-agent", "search");

    // Verify the body was stored correctly
    expect(useSkillStore.getState().activeSkillBodies["search"]).toBe(mockSkillContent.body);

    const result = useSkillStore.getState().getSkillsPromptSection();
    expect(result).toContain("[AVAILABLE SKILLS]");
    expect(result).toContain("[ACTIVE SKILLS]");
    expect(result).toContain("--- search ---");
    expect(result).toContain("--- end ---");
  });

  it("clear resets all state", async () => {
    vi.mocked(cmds.listSkills).mockResolvedValue(mockSkills);
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    await useSkillStore.getState().loadSkills("test-agent");
    await useSkillStore.getState().activateSkill("test-agent", "search");

    useSkillStore.getState().clear();

    const s = useSkillStore.getState();
    expect(s.availableSkills).toEqual([]);
    expect(s.activeSkillBodies).toEqual({});
    expect(s.activeSkillNames).toEqual([]);
    expect(s.activeSkillTokens).toBe(0);
    expect(s.catalogPrompt).toBe("");
    expect(s.isLoading).toBe(false);
  });

  // ── Rollback / persistence failure tests ──

  it("activateSkill does not update local state when DB persistence fails", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    vi.mocked(cmds.updateConversationSkills).mockRejectedValue(new Error("DB write failed"));

    const result = await useSkillStore.getState().activateSkill("test-agent", "search", "conv-1");

    expect(result).toBe(false);
    const s = useSkillStore.getState();
    expect(s.activeSkillNames).toEqual([]);
    expect(s.activeSkillBodies).toEqual({});
  });

  it("deactivateSkill does not update local state when DB persistence fails", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    // First activate without convId (no DB)
    await useSkillStore.getState().activateSkill("test-agent", "search");
    expect(useSkillStore.getState().activeSkillNames).toEqual(["search"]);

    // Now deactivate with convId that fails
    vi.mocked(cmds.updateConversationSkills).mockRejectedValue(new Error("DB write failed"));
    const result = await useSkillStore.getState().deactivateSkill("search", "conv-1");

    expect(result).toBe(false);
    // Local state should be unchanged
    expect(useSkillStore.getState().activeSkillNames).toEqual(["search"]);
  });

  it("deactivateSkill returns true on success", async () => {
    vi.mocked(cmds.readSkill).mockResolvedValue(mockSkillContent);
    await useSkillStore.getState().activateSkill("test-agent", "search");

    const result = await useSkillStore.getState().deactivateSkill("search");
    expect(result).toBe(true);
    expect(useSkillStore.getState().activeSkillNames).toEqual([]);
  });

  // ── Stale-request race guard tests ──

  it("stale loadSkills result is discarded when clear() is called during load", async () => {
    let resolveList: (v: SkillMetadata[]) => void;
    const slowPromise = new Promise<SkillMetadata[]>((r) => { resolveList = r; });
    vi.mocked(cmds.listSkills).mockReturnValue(slowPromise);

    // Start loading
    const loadPromise = useSkillStore.getState().loadSkills("old-agent");

    // Clear before load completes (simulates rapid agent switch)
    useSkillStore.getState().clear();

    // Now resolve the slow load
    resolveList!(mockSkills);
    await loadPromise;

    // Stale result should be discarded — store should remain cleared
    const s = useSkillStore.getState();
    expect(s.availableSkills).toEqual([]);
    expect(s.catalogPrompt).toBe("");
  });

  it("stale loadSkills result is discarded when new loadSkills starts", async () => {
    let resolveFirst: (v: SkillMetadata[]) => void;
    const firstPromise = new Promise<SkillMetadata[]>((r) => { resolveFirst = r; });
    const secondSkills: SkillMetadata[] = [
      { name: "new-skill", description: "New", source: "agent", path: "/skills/new", diagnostics: [] },
    ];

    vi.mocked(cmds.listSkills)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(secondSkills);

    // Start first load (slow)
    const p1 = useSkillStore.getState().loadSkills("old-agent");
    // Start second load (fast) — should supersede
    const p2 = useSkillStore.getState().loadSkills("new-agent");
    await p2;

    // Now resolve the stale first load
    resolveFirst!(mockSkills);
    await p1;

    // Store should have the second load's result, not the first
    const s = useSkillStore.getState();
    expect(s.availableSkills).toEqual(secondSkills);
    expect(s.catalogPrompt).toContain("new-skill");
    expect(s.catalogPrompt).not.toContain("search");
  });
});
