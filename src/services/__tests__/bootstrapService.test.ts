import { describe, it, expect, beforeEach } from "vitest";
import * as cmds from "../tauriCommands";
import {
  parseAgentName,
  isBootstrapComplete,
  executeBootstrapTurn,
} from "../bootstrapService";

vi.mock("../tauriCommands");

beforeEach(() => {
  vi.mocked(cmds.readAgentFile).mockReset();
  vi.mocked(cmds.writeAgentFile).mockReset();
  vi.mocked(cmds.bootstrapCompletion).mockReset();
});

describe("parseAgentName", () => {
  it("extracts name from # heading", () => {
    expect(parseAgentName("# MyAgent\nsome content")).toBe("MyAgent");
  });

  it("returns fallback for no heading", () => {
    expect(parseAgentName("no heading here")).toBe("Agent");
  });

  it("trims whitespace", () => {
    expect(parseAgentName("#  Spaced  ")).toBe("Spaced");
  });

  it("returns fallback for empty string", () => {
    expect(parseAgentName("")).toBe("Agent");
  });
});

describe("isBootstrapComplete", () => {
  it("returns true when all 4 files present", () => {
    expect(
      isBootstrapComplete(["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"]),
    ).toBe(true);
  });

  it("returns false when some missing", () => {
    expect(isBootstrapComplete(["IDENTITY.md", "SOUL.md"])).toBe(false);
  });

  it("returns false for empty array", () => {
    expect(isBootstrapComplete([])).toBe(false);
  });
});

describe("executeBootstrapTurn", () => {
  it("returns text for no tool_calls", async () => {
    vi.mocked(cmds.bootstrapCompletion).mockResolvedValue({
      message: {
        content: "Hello! Let me help you set up.",
        tool_calls: undefined,
      },
    });

    const result = await executeBootstrapTurn(
      [],
      "Hi",
      "test-folder",
      "test-model",
    );

    expect(result.responseText).toBe("Hello! Let me help you set up.");
    expect(result.filesWritten).toEqual([]);
    expect(result.apiMessages.length).toBeGreaterThan(0);
  });

  it("processes write_file tool calls", async () => {
    vi.mocked(cmds.writeAgentFile).mockResolvedValue(undefined);

    vi.mocked(cmds.bootstrapCompletion)
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            {
              id: "tc1",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({
                  path: "IDENTITY.md",
                  content: "# TestBot",
                }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: "Done writing!",
          tool_calls: undefined,
        },
      });

    const result = await executeBootstrapTurn(
      [],
      "Create my agent",
      "test-folder",
      "test-model",
    );

    expect(cmds.writeAgentFile).toHaveBeenCalledWith(
      "test-folder",
      "IDENTITY.md",
      "# TestBot",
    );
    expect(result.filesWritten).toContain("IDENTITY.md");
    expect(result.responseText).toBe("Done writing!");
  });

  it("processes read_file tool calls", async () => {
    vi.mocked(cmds.readAgentFile).mockResolvedValue("# Existing Content");

    vi.mocked(cmds.bootstrapCompletion)
      .mockResolvedValueOnce({
        message: {
          content: null,
          tool_calls: [
            {
              id: "tc2",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "IDENTITY.md" }),
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        message: {
          content: "I read the file.",
          tool_calls: undefined,
        },
      });

    const result = await executeBootstrapTurn(
      [],
      "Read identity",
      "test-folder",
      "test-model",
    );

    expect(cmds.readAgentFile).toHaveBeenCalledWith("test-folder", "IDENTITY.md");
    expect(result.responseText).toBe("I read the file.");
    const toolMsg = result.apiMessages.find(
      (m: any) => m.role === "tool" && m.tool_call_id === "tc2",
    );
    expect(toolMsg).toBeDefined();
    expect(toolMsg.content).toBe("# Existing Content");
  });
});
