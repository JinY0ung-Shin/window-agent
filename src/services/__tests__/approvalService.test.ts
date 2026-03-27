import { describe, it, expect, beforeEach } from "vitest";
import {
  isCredentialBearingTool,
  extractBrowserDomain,
  isBrowserDomainApproved,
  approveBrowserDomain,
  clearBrowserApprovals,
} from "../browserApprovalService";

vi.mock("../tauriCommands", () => ({
  approveBrowserDomain: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  // Clear all approvals between tests to ensure isolation
  clearBrowserApprovals("conv-1");
  clearBrowserApprovals("conv-2");
});

describe("isCredentialBearingTool", () => {
  it("returns false for non-credential tools", () => {
    expect(isCredentialBearingTool({ name: "write_file" }, true)).toBe(false);
  });

  it("returns true for run_command when agent has credentials", () => {
    expect(isCredentialBearingTool({ name: "run_command" }, true)).toBe(true);
  });

  it("returns false for run_command when agent has no credentials", () => {
    expect(isCredentialBearingTool({ name: "run_command" }, false)).toBe(false);
  });

  it("returns true for browser_type with credential placeholder", () => {
    expect(isCredentialBearingTool({
      name: "browser_type",
      arguments: JSON.stringify({ ref: 5, text: "{{credential:github-password}}" }),
    }, true)).toBe(true);
  });

  it("returns false for browser_type without credential placeholder", () => {
    expect(isCredentialBearingTool({
      name: "browser_type",
      arguments: JSON.stringify({ ref: 5, text: "hello" }),
    }, true)).toBe(false);
  });

  it("returns false for browser_type with malformed placeholder", () => {
    expect(isCredentialBearingTool({
      name: "browser_type",
      arguments: JSON.stringify({ ref: 5, text: "{{credential:key@bad}}" }),
    }, true)).toBe(false);
  });

  it("returns false for browser_type when agent has no credentials", () => {
    expect(isCredentialBearingTool({
      name: "browser_type",
      arguments: JSON.stringify({ ref: 5, text: "{{credential:my-key}}" }),
    }, false)).toBe(false);
  });
});

describe("extractBrowserDomain", () => {
  it("returns null for non-browser tools", () => {
    expect(extractBrowserDomain("write_file", JSON.stringify({ url: "https://example.com" }))).toBeNull();
  });

  it("extracts hostname from browser_ tool with url arg", () => {
    expect(
      extractBrowserDomain("browser_navigate", JSON.stringify({ url: "https://example.com/page" })),
    ).toBe("example.com");
  });

  it("returns null for browser_ tool without url arg", () => {
    expect(extractBrowserDomain("browser_click", JSON.stringify({ selector: "#btn" }))).toBeNull();
  });

  it("returns null for invalid JSON arguments", () => {
    expect(extractBrowserDomain("browser_navigate", "not json")).toBeNull();
  });
});

describe("isBrowserDomainApproved / approveBrowserDomain / clearBrowserApprovals", () => {
  it("returns false when no domains have been approved", () => {
    expect(isBrowserDomainApproved("conv-1", "example.com")).toBe(false);
  });

  it("returns false for null domain", () => {
    expect(isBrowserDomainApproved("conv-1", null)).toBe(false);
  });

  it("returns true after approving a domain", () => {
    approveBrowserDomain("conv-1", "example.com");
    expect(isBrowserDomainApproved("conv-1", "example.com")).toBe(true);
  });

  it("approval is scoped to conversation", () => {
    approveBrowserDomain("conv-1", "example.com");
    expect(isBrowserDomainApproved("conv-2", "example.com")).toBe(false);
  });

  it("clearBrowserApprovals removes all approvals for a conversation", () => {
    approveBrowserDomain("conv-1", "example.com");
    approveBrowserDomain("conv-1", "other.com");
    clearBrowserApprovals("conv-1");
    expect(isBrowserDomainApproved("conv-1", "example.com")).toBe(false);
    expect(isBrowserDomainApproved("conv-1", "other.com")).toBe(false);
  });
});
