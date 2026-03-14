import { describe, it, expect } from "vitest";
import {
  parseToolsMd,
  serializeToolsMd,
  normalizeToolsMd,
  canRoundTrip,
  type ToolDefinition,
} from "../toolRegistry";

describe("serializeToolsMd", () => {
  it("returns empty string for empty array", () => {
    expect(serializeToolsMd([])).toBe("");
  });

  it("serializes a single tool without parameters", () => {
    const tools: ToolDefinition[] = [
      { name: "web_search", description: "Search the web", tier: "auto", parameters: { type: "object", properties: {} } },
    ];
    const result = serializeToolsMd(tools);
    expect(result).toContain("## web_search");
    expect(result).toContain("- description: Search the web");
    expect(result).toContain("- tier: auto");
    expect(result).not.toContain("- parameters:");
  });

  it("serializes a tool with parameters", () => {
    const tools: ToolDefinition[] = [
      {
        name: "read_file",
        description: "Read a file",
        tier: "confirm",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "File path" },
            encoding: { type: "string", description: "Encoding" },
          },
          required: ["path"],
        },
      },
    ];
    const result = serializeToolsMd(tools);
    expect(result).toContain("- parameters:");
    expect(result).toContain("  - path (string, required): File path");
    expect(result).toContain("  - encoding (string, optional): Encoding");
  });

  it("serializes multiple tools separated by blank lines", () => {
    const tools: ToolDefinition[] = [
      { name: "tool_a", description: "A", tier: "auto", parameters: { type: "object", properties: {} } },
      { name: "tool_b", description: "B", tier: "deny", parameters: { type: "object", properties: {} } },
    ];
    const result = serializeToolsMd(tools);
    expect(result).toContain("## tool_a");
    expect(result).toContain("## tool_b");
    expect(result).toContain("- tier: deny");
  });

  it("serializes all tier types", () => {
    const tiers = ["auto", "confirm", "deny"] as const;
    for (const tier of tiers) {
      const tools: ToolDefinition[] = [
        { name: "t", description: "d", tier, parameters: { type: "object", properties: {} } },
      ];
      expect(serializeToolsMd(tools)).toContain(`- tier: ${tier}`);
    }
  });
});

describe("round-trip: parseToolsMd <-> serializeToolsMd", () => {
  it("round-trips a simple tool", () => {
    const original: ToolDefinition[] = [
      {
        name: "exec",
        description: "Execute command",
        tier: "confirm",
        parameters: {
          type: "object",
          properties: {
            cmd: { type: "string", description: "Command" },
          },
          required: ["cmd"],
        },
      },
    ];
    const serialized = serializeToolsMd(original);
    const parsed = parseToolsMd(serialized);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe("exec");
    expect(parsed[0].description).toBe("Execute command");
    expect(parsed[0].tier).toBe("confirm");
    expect(parsed[0].parameters.properties.cmd.type).toBe("string");
    expect(parsed[0].parameters.required).toEqual(["cmd"]);
  });

  it("round-trips multiple tools with mixed tiers and params", () => {
    const original: ToolDefinition[] = [
      {
        name: "search",
        description: "Search",
        tier: "auto",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "Query" } },
          required: ["query"],
        },
      },
      {
        name: "delete_file",
        description: "Delete a file",
        tier: "deny",
        parameters: { type: "object", properties: {} },
      },
    ];
    const serialized = serializeToolsMd(original);
    const parsed = parseToolsMd(serialized);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe("search");
    expect(parsed[0].tier).toBe("auto");
    expect(parsed[1].name).toBe("delete_file");
    expect(parsed[1].tier).toBe("deny");
  });

  it("round-trips empty tool list", () => {
    const serialized = serializeToolsMd([]);
    const parsed = parseToolsMd(serialized);
    expect(parsed).toHaveLength(0);
  });
});

describe("normalizeToolsMd", () => {
  it("returns empty string for empty input", () => {
    expect(normalizeToolsMd("")).toBe("");
  });

  it("returns empty string for whitespace-only input", () => {
    expect(normalizeToolsMd("   \n  \n   ")).toBe("");
  });

  it("removes # Tools header", () => {
    const input = "# Tools\n\n## my_tool\n- description: test\n- tier: auto";
    const result = normalizeToolsMd(input);
    expect(result).not.toContain("# Tools");
    expect(result).toContain("## my_tool");
  });

  it("collapses multiple blank lines", () => {
    const input = "## a\n- description: x\n\n\n\n## b\n- description: y";
    const result = normalizeToolsMd(input);
    expect(result).not.toContain("\n\n\n");
  });

  it("strips trailing whitespace from lines", () => {
    const input = "## tool   \n- description: test   \n- tier: auto  ";
    const result = normalizeToolsMd(input);
    for (const line of result.split("\n")) {
      expect(line).toBe(line.trimEnd());
    }
  });

  it("replaces tabs with spaces", () => {
    const input = "## tool\n\t- description: test";
    const result = normalizeToolsMd(input);
    expect(result).not.toContain("\t");
  });
});

describe("canRoundTrip", () => {
  it("returns true for empty content", () => {
    expect(canRoundTrip("")).toBe(true);
  });

  it("returns true for well-formed TOOLS.md", () => {
    const md = "## my_tool\n- description: A tool\n- tier: auto\n";
    expect(canRoundTrip(md)).toBe(true);
  });

  it("returns true for content with # Tools header", () => {
    const md = "# Tools\n\n## my_tool\n- description: A tool\n- tier: auto\n";
    expect(canRoundTrip(md)).toBe(true);
  });

  it("returns false for content with comments", () => {
    const md = "<!-- custom comment -->\n## my_tool\n- description: A tool\n- tier: auto\n";
    expect(canRoundTrip(md)).toBe(false);
  });

  it("returns false for content with extra manual text", () => {
    const md = "## my_tool\n- description: A tool\n- tier: auto\nSome extra notes here\n";
    expect(canRoundTrip(md)).toBe(false);
  });

  it("returns false for tool names with hyphens (not \\w+)", () => {
    const md = "## web-search\n- description: Search\n- tier: auto\n";
    expect(canRoundTrip(md)).toBe(false);
  });

  it("returns false for param names with hyphens", () => {
    const md = "## tool\n- description: T\n- tier: auto\n- parameters:\n  - file-path (string, required): Path\n";
    expect(canRoundTrip(md)).toBe(false);
  });
});
