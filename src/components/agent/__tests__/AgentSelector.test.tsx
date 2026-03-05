import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AgentSelector from "../AgentSelector";
import { useAgentStore } from "../../../stores/agentStore";
import { useChatStore } from "../../../stores/chatStore";
import { makeAgent } from "../../../__tests__/testFactories";

vi.mock("../../../services/tauriCommands");

const initialAgentState = useAgentStore.getState();
const initialChatState = useChatStore.getState();

beforeEach(() => {
  useAgentStore.setState(initialAgentState, true);
  useChatStore.setState(initialChatState, true);
});

describe("AgentSelector", () => {
  it("renders header '에이전트 선택'", () => {
    render(<AgentSelector />);
    expect(screen.getByText("에이전트 선택")).toBeInTheDocument();
  });

  it("renders agent cards when agents present", () => {
    useAgentStore.setState({ agents: [makeAgent({ name: "에이전트 1" }), makeAgent({ id: "a2", name: "에이전트 2" })] });
    render(<AgentSelector />);
    expect(screen.getByText("에이전트 1")).toBeInTheDocument();
    expect(screen.getByText("에이전트 2")).toBeInTheDocument();
  });

  it("renders agent name and description", () => {
    useAgentStore.setState({ agents: [makeAgent({ name: "테스트 에이전트", description: "테스트 설명" })] });
    render(<AgentSelector />);
    expect(screen.getByText("테스트 에이전트")).toBeInTheDocument();
    expect(screen.getByText("테스트 설명")).toBeInTheDocument();
  });

  it("shows MANAGER badge for default agent (is_default=true)", () => {
    useAgentStore.setState({ agents: [makeAgent({ name: "매니저", is_default: true })] });
    render(<AgentSelector />);
    expect(screen.getByText("MANAGER")).toBeInTheDocument();
  });

  it("hides MANAGER badge for non-default agent", () => {
    useAgentStore.setState({ agents: [makeAgent({ name: "일반 에이전트", is_default: false })] });
    render(<AgentSelector />);
    expect(screen.queryByText("MANAGER")).not.toBeInTheDocument();
  });

  it("clicking card calls prepareForAgent with correct agent ID", () => {
    const prepareSpy = vi.fn();
    useChatStore.setState({ prepareForAgent: prepareSpy });
    useAgentStore.setState({ agents: [makeAgent({ id: "agent-x", name: "클릭 대상" })] });
    render(<AgentSelector />);

    fireEvent.click(screen.getByText("클릭 대상"));
    expect(prepareSpy).toHaveBeenCalledWith("agent-x");
  });

  it("renders '새 에이전트' card", () => {
    render(<AgentSelector />);
    expect(screen.getByText("새 에이전트")).toBeInTheDocument();
  });

  it("clicking new agent card calls startBootstrap", () => {
    const bootstrapSpy = vi.fn();
    useChatStore.setState({ startBootstrap: bootstrapSpy });
    render(<AgentSelector />);

    fireEvent.click(screen.getByText("새 에이전트"));
    expect(bootstrapSpy).toHaveBeenCalled();
  });
});
