import { describe, it, expect } from "vitest";
import { buildPromptReadySlice } from "../memoryAdapter";
import type { VaultNoteSummary } from "../vaultTypes";

const makeNote = (overrides: Partial<VaultNoteSummary> = {}): VaultNoteSummary => ({
  id: "n1",
  agent: "agent-1",
  noteType: "insight",
  title: "Test",
  bodyPreview: "preview content",
  tags: [],
  confidence: 1.0,
  scope: null,
  sourceConversation: null,
  created: "2026-01-01T00:00:00Z",
  updated: "2026-01-01T00:00:00Z",
  ...overrides,
});

describe("buildPromptReadySlice", () => {
  it("returns empty string for empty notes", () => {
    expect(buildPromptReadySlice([])).toBe("");
  });

  it("formats notes with header", () => {
    const result = buildPromptReadySlice([makeNote()]);
    expect(result).toContain("[MEMORY NOTES]");
    expect(result).toContain("- Test: preview content");
  });

  it("sorts notes by created descending (newest first)", () => {
    const notes = [
      makeNote({ id: "old", title: "Old", created: "2026-01-01T00:00:00Z" }),
      makeNote({ id: "new", title: "New", created: "2026-01-03T00:00:00Z" }),
    ];
    const result = buildPromptReadySlice(notes);
    const lines = result.split("\n");
    expect(lines[1]).toContain("New");
    expect(lines[2]).toContain("Old");
  });

  it("respects token budget", () => {
    const notes = Array.from({ length: 100 }, (_, i) =>
      makeNote({
        id: `n${i}`,
        title: `Note ${i}`,
        bodyPreview: "A".repeat(50),
        created: new Date(2026, 0, i + 1).toISOString(),
      }),
    );
    const result = buildPromptReadySlice(notes, 100);
    // Should not include all 100 notes
    const lines = result.split("\n").filter((l) => l.startsWith("- "));
    expect(lines.length).toBeLessThan(100);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("returns empty when first note exceeds budget", () => {
    const note = makeNote({ title: "X".repeat(200), bodyPreview: "Y".repeat(200) });
    const result = buildPromptReadySlice([note], 10);
    expect(result).toBe("");
  });
});
