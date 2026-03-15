import { describe, it, expect, beforeEach } from "vitest";
import { resetTransientChatState, resetChatContext } from "../resetHelper";
import { useConversationStore } from "../conversationStore";
import { useMessageStore } from "../messageStore";
import { useStreamStore } from "../streamStore";
import { useBootstrapStore } from "../bootstrapStore";
import { useToolRunStore } from "../toolRunStore";
import { useSummaryStore } from "../summaryStore";
import { useAgentStore } from "../agentStore";
import { useMemoryStore } from "../memoryStore";
import { useDebugStore } from "../debugStore";
import { useSkillStore } from "../skillStore";

vi.mock("../../services/tauriCommands");

const initialConvState = useConversationStore.getState();
const initialMsgState = useMessageStore.getState();
const initialStreamState = useStreamStore.getState();
const initialBootstrapState = useBootstrapStore.getState();
const initialToolRunState = useToolRunStore.getState();
const initialSummaryState = useSummaryStore.getState();
const initialAgentState = useAgentStore.getState();
const initialMemoryState = useMemoryStore.getState();
const initialDebugState = useDebugStore.getState();
const initialSkillState = useSkillStore.getState();

function setDirtyState() {
  useConversationStore.setState({ currentConversationId: "c1" });
  useMessageStore.setState({ messages: [{ id: "1", type: "user", content: "msg" }], inputValue: "draft" });
  useStreamStore.setState({ activeRun: { requestId: "r1", conversationId: "c1", targetMessageId: "m1", status: "streaming" } });
  useBootstrapStore.setState({ isBootstrapping: true, bootstrapFolderName: "agent-123" });
  useToolRunStore.setState({ toolRunState: "tool_running", pendingToolCalls: [{ id: "t1", name: "test", arguments: "{}" }] });
  useSummaryStore.setState({ currentSummary: "old summary", summaryUpToMessageId: "m1", summaryJobId: "j1" });
  useAgentStore.setState({ selectedAgentId: "a1" });
  useMemoryStore.setState({ notes: [{ id: "n1", agent_id: "a1", title: "note", content: "content", created_at: "", updated_at: "" }], currentAgentId: "a1" });
  useDebugStore.setState({ logs: [{ id: "l1", conversation_id: "c1", tool_name: "test", tool_input: "{}", status: "completed", created_at: "" }] });
  useSkillStore.setState({ availableSkills: [{ name: "test", description: "test" }] });
}

beforeEach(() => {
  useConversationStore.setState(initialConvState, true);
  useMessageStore.setState(initialMsgState, true);
  useStreamStore.setState(initialStreamState, true);
  useBootstrapStore.setState(initialBootstrapState, true);
  useToolRunStore.setState(initialToolRunState, true);
  useSummaryStore.setState(initialSummaryState, true);
  useAgentStore.setState(initialAgentState, true);
  useMemoryStore.setState(initialMemoryState, true);
  useDebugStore.setState(initialDebugState, true);
  useSkillStore.setState(initialSkillState, true);
});

describe("resetTransientChatState", () => {
  it("clears all transient state but preserves selection", () => {
    setDirtyState();
    resetTransientChatState();

    // Transient state should be cleared
    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useMessageStore.getState().inputValue).toBe("");
    expect(useStreamStore.getState().activeRun).toBeNull();
    expect(useBootstrapStore.getState().isBootstrapping).toBe(false);
    expect(useToolRunStore.getState().toolRunState).toBe("idle");
    expect(useToolRunStore.getState().pendingToolCalls).toEqual([]);
    expect(useSummaryStore.getState().currentSummary).toBeNull();
    expect(useSummaryStore.getState().summaryJobId).toBeNull();
    expect(useDebugStore.getState().logs).toEqual([]);
    expect(useSkillStore.getState().availableSkills).toEqual([]);
    expect(useMemoryStore.getState().notes).toEqual([]);
    expect(useMemoryStore.getState().currentAgentId).toBeNull();

    // Selection should be PRESERVED
    expect(useConversationStore.getState().currentConversationId).toBe("c1");
    expect(useAgentStore.getState().selectedAgentId).toBe("a1");
  });
});

describe("resetChatContext", () => {
  it("clears everything including selection", () => {
    setDirtyState();
    resetChatContext();

    // Everything should be cleared
    expect(useConversationStore.getState().currentConversationId).toBeNull();
    expect(useAgentStore.getState().selectedAgentId).toBeNull();
    expect(useMessageStore.getState().messages).toEqual([]);
    expect(useStreamStore.getState().activeRun).toBeNull();
    expect(useBootstrapStore.getState().isBootstrapping).toBe(false);
    expect(useToolRunStore.getState().toolRunState).toBe("idle");
    expect(useSummaryStore.getState().currentSummary).toBeNull();
    expect(useDebugStore.getState().logs).toEqual([]);
    expect(useSkillStore.getState().availableSkills).toEqual([]);
    expect(useMemoryStore.getState().notes).toEqual([]);
  });
});
