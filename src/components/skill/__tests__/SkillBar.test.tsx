import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SkillBar from "../SkillBar";
import { useSkillStore } from "../../../stores/skillStore";
import { useAgentStore } from "../../../stores/agentStore";
import { useConversationStore } from "../../../stores/conversationStore";

vi.mock("../../../services/tauriCommands");

const initialSkillState = useSkillStore.getState();
const initialAgentState = useAgentStore.getState();
const initialConvState = useConversationStore.getState();

beforeEach(() => {
  useSkillStore.setState(initialSkillState, true);
  useAgentStore.setState(initialAgentState, true);
  useConversationStore.setState(initialConvState, true);
});

describe("SkillBar", () => {
  it("returns null when no available skills", () => {
    useSkillStore.setState({ availableSkills: [] });
    const { container } = render(<SkillBar agentId="a1" />);
    expect(container.innerHTML).toBe("");
  });

  it("renders collapsed with active count", () => {
    useSkillStore.setState({
      availableSkills: [
        { name: "s1", description: "Skill 1", source: "agent", path: "/p", diagnostics: [] },
      ],
      activeSkillNames: ["s1"],
    });
    useAgentStore.setState({
      agents: [{ id: "a1", folder_name: "test-agent", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });

    render(<SkillBar agentId="a1" />);
    expect(screen.getByText("스킬 1개 활성")).toBeInTheDocument();
  });

  it("shows chips when expanded", () => {
    useSkillStore.setState({
      availableSkills: [
        { name: "code-review", description: "Review code", source: "agent", path: "/p", diagnostics: [] },
        { name: "translate", description: "Translate text", source: "agent", path: "/p", diagnostics: [] },
      ],
      activeSkillNames: [],
      activeSkillTokens: 0,
    });
    useAgentStore.setState({
      agents: [{ id: "a1", folder_name: "test-agent", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });

    render(<SkillBar agentId="a1" />);

    // Click to expand
    fireEvent.click(screen.getByText("스킬 0개 활성"));

    expect(screen.getByText("code-review")).toBeInTheDocument();
    expect(screen.getByText("translate")).toBeInTheDocument();
    expect(screen.getByText("토큰: ~0/2000")).toBeInTheDocument();
  });

  it("shows warning token color when >= 2000", () => {
    useSkillStore.setState({
      availableSkills: [
        { name: "s1", description: "d", source: "agent", path: "/p", diagnostics: [] },
      ],
      activeSkillNames: ["s1"],
      activeSkillTokens: 2100,
    });
    useAgentStore.setState({
      agents: [{ id: "a1", folder_name: "test-agent", name: "Test", avatar: null, description: "", model: null, temperature: null, thinking_enabled: null, thinking_budget: null, is_default: false, sort_order: 0, created_at: "", updated_at: "" }],
    });

    render(<SkillBar agentId="a1" />);
    fireEvent.click(screen.getByText("스킬 1개 활성"));

    const indicator = screen.getByText("토큰: ~2100/2000");
    expect(indicator.classList.contains("skill-token-warn")).toBe(true);
  });
});
