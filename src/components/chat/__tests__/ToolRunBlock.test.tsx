import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ChatMessage } from "../../../services/types";
import { useToolRunStore } from "../../../stores/toolRunStore";
import ToolRunBlock from "../ToolRunBlock";
import type { ToolRunStep } from "../chatRenderBlocks";

vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));
vi.mock("remark-gfm", () => ({ default: () => {} }));
vi.mock("rehype-highlight", () => ({ default: () => {} }));
vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

const initialToolState = useToolRunStore.getState();

function createAssistantMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "assistant-1",
    type: "agent",
    content: "",
    status: "complete",
    ...overrides,
  };
}

function createStep(overrides: Partial<ToolRunStep> = {}): ToolRunStep {
  return {
    toolCall: {
      id: "call-1",
      name: "http_request",
      arguments: "{\"url\":\"https://example.com\"}",
    },
    status: "executed",
    resultMessage: {
      id: "tool-result-1",
      type: "tool",
      content: "GET https://example.com",
      status: "complete",
      tool_call_id: "call-1",
      tool_name: "http_request",
    },
    ...overrides,
  };
}

beforeEach(() => {
  useToolRunStore.setState(initialToolState, true);
});

describe("ToolRunBlock", () => {
  it("starts collapsed for fully successful runs and expands on demand", () => {
    render(
      <ToolRunBlock
        assistantMessage={createAssistantMessage()}
        steps={[
          createStep({ toolCall: { id: "call-1", name: "http_request", arguments: "{}" } }),
          createStep({
            toolCall: { id: "call-2", name: "browser_click", arguments: "{}" },
            resultMessage: {
              id: "tool-result-2",
              type: "tool",
              content: "clicked",
              status: "complete",
              tool_call_id: "call-2",
              tool_name: "browser_click",
            },
          }),
        ]}
        isActiveRun={false}
      />,
    );

    expect(screen.getByText("도구 2개 실행")).toBeInTheDocument();
    expect(screen.queryByText("http_request")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /도구 2개 실행/i }));
    expect(screen.getByText("http_request")).toBeInTheDocument();
    expect(screen.getByText("browser_click")).toBeInTheDocument();
  });

  it("shows error details by default for non-successful rows", () => {
    render(
      <ToolRunBlock
        assistantMessage={createAssistantMessage()}
        steps={[
          createStep({
            status: "error",
            resultMessage: {
              id: "tool-result-error",
              type: "tool",
              content: "Error: request failed",
              status: "complete",
              tool_call_id: "call-1",
              tool_name: "http_request",
            },
          }),
        ]}
        isActiveRun={false}
      />,
    );

    expect(screen.getByText("오류")).toBeInTheDocument();
    expect(screen.getAllByText("Error: request failed")).toHaveLength(2);
  });

  it("shows approval actions for waiting active runs", () => {
    useToolRunStore.setState({
      toolRunState: "tool_waiting",
      pendingToolCalls: [{ id: "call-1", name: "http_request", arguments: "{}" }],
    });

    render(
      <ToolRunBlock
        assistantMessage={createAssistantMessage()}
        steps={[
          createStep({
            status: "pending",
            resultMessage: undefined,
          }),
        ]}
        isActiveRun={true}
      />,
    );

    fireEvent.click(screen.getByText("승인"));
    expect(useToolRunStore.getState().toolRunState).toBe("tool_running");
  });

  it("reuses browser result detail rendering inside grouped rows", () => {
    render(
      <ToolRunBlock
        assistantMessage={createAssistantMessage()}
        steps={[
          createStep({
            toolCall: { id: "call-browser", name: "browser_click", arguments: "{\"ref\":39}" },
            resultMessage: {
              id: "tool-browser",
              type: "tool",
              content: JSON.stringify({
                success: true,
                url: "https://example.com/news",
                title: "News",
                snapshot: "button: Open",
                element_count: 1,
                screenshot_path: "/tmp/browser.png",
              }),
              status: "complete",
              tool_call_id: "call-browser",
              tool_name: "browser_click",
            },
          }),
        ]}
        isActiveRun={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /도구 1개 실행/i }));
    fireEvent.click(screen.getByRole("button", { name: /browser_click/i }));

    expect(screen.getByAltText("Browser screenshot")).toBeInTheDocument();
    expect(screen.getByText(/Accessibility Snapshot/)).toBeInTheDocument();
  });
});
