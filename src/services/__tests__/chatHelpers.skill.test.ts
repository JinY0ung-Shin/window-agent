import { describe, it, expect } from "vitest";
import { buildConversationContext } from "../chatHelpers";
import type { ChatMessage } from "../types";

function makeMsg(id: string, content: string, type: "user" | "agent" = "user"): ChatMessage {
  return { id, type, content, status: "complete" };
}

describe("buildConversationContext with skillsSection", () => {
  it("injects skillsSection between persona and memory", () => {
    const messages = [makeMsg("1", "hello", "user")];
    const result = buildConversationContext({
      messages,
      summary: null,
      baseSystemPrompt: "You are helpful.",
      skillsSection: "[AVAILABLE SKILLS]\n- search: Web search",
      memoryNotes: [
        { id: "n1", agent_id: "a1", title: "Note", content: "remember this", created_at: "2024-01-01", updated_at: "2024-01-01" },
      ],
    });

    // Skills should come before memory
    const skillsIdx = result.systemPrompt.indexOf("[AVAILABLE SKILLS]");
    const memoryIdx = result.systemPrompt.indexOf("[MEMORY NOTES]");
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(memoryIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeLessThan(memoryIdx);
  });

  it("works without skillsSection (backward compat)", () => {
    const messages = [makeMsg("1", "hello", "user")];
    const result = buildConversationContext({
      messages,
      summary: null,
      baseSystemPrompt: "You are helpful.",
    });
    expect(result.systemPrompt).toBe("You are helpful.");
    expect(result.apiMessages.length).toBe(1);
  });

  it("includes skillsSection content in system prompt", () => {
    const messages = [makeMsg("1", "hello", "user")];
    const skillsSection = "[AVAILABLE SKILLS]\n- calc: Calculator\n\n[ACTIVE SKILLS]\n--- calc ---\nDo math.\n--- end ---";
    const result = buildConversationContext({
      messages,
      summary: null,
      baseSystemPrompt: "Base prompt.",
      skillsSection,
    });
    expect(result.systemPrompt).toContain("[AVAILABLE SKILLS]");
    expect(result.systemPrompt).toContain("[ACTIVE SKILLS]");
    expect(result.systemPrompt).toContain("Do math.");
  });

  it("skillsSection comes before summary", () => {
    const messages = [makeMsg("1", "hello", "user")];
    const result = buildConversationContext({
      messages,
      summary: "Previously discussed weather.",
      baseSystemPrompt: "Base.",
      skillsSection: "[AVAILABLE SKILLS]\n- search: Search",
    });

    const skillsIdx = result.systemPrompt.indexOf("[AVAILABLE SKILLS]");
    const summaryIdx = result.systemPrompt.indexOf("[이전 대화 요약]");
    expect(skillsIdx).toBeGreaterThan(-1);
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(skillsIdx).toBeLessThan(summaryIdx);
  });
});
