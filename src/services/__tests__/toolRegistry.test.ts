import { describe, it, expect } from "vitest";
import {
  toOpenAITools,
  getToolTier,
  type ToolDefinition,
} from "../toolRegistry";

describe("toOpenAITools", () => {
  it("returns empty array for empty input", () => {
    expect(toOpenAITools([])).toEqual([]);
  });

  it("converts tool definitions to OpenAI format", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "Read a file",
        tier: "auto",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ];
    const result = toOpenAITools(tools);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "read_file",
        description: "Read a file",
        parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    });
  });

  it("converts multiple tools", () => {
    const tools: ToolDefinition[] = [
      { name: "a", description: "A", tier: "auto", parameters: { type: "object", properties: {} } },
      { name: "b", description: "B", tier: "confirm", parameters: { type: "object", properties: {} } },
    ];
    const result = toOpenAITools(tools);
    expect(result).toHaveLength(2);
    expect(result[0]).toHaveProperty("function.name", "a");
    expect(result[1]).toHaveProperty("function.name", "b");
  });
});

describe("getToolTier", () => {
  const tools: ToolDefinition[] = [
    { name: "read_file", description: "Read", tier: "auto", parameters: { type: "object", properties: {} } },
    { name: "write_file", description: "Write", tier: "confirm", parameters: { type: "object", properties: {} } },
    { name: "dangerous", description: "Danger", tier: "deny", parameters: { type: "object", properties: {} } },
  ];

  it("returns tier for known tool", () => {
    expect(getToolTier(tools, "read_file")).toBe("auto");
    expect(getToolTier(tools, "write_file")).toBe("confirm");
    expect(getToolTier(tools, "dangerous")).toBe("deny");
  });

  it("returns 'confirm' for unknown tool", () => {
    expect(getToolTier(tools, "unknown_tool")).toBe("confirm");
  });

  it("returns 'confirm' for empty definitions", () => {
    expect(getToolTier([], "anything")).toBe("confirm");
  });
});
