import { describe, it, expect, beforeEach } from "vitest";
import {
  hasCredentialRefs,
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

describe("hasCredentialRefs", () => {
  it("returns false for non-http_request tools", () => {
    expect(hasCredentialRefs({ name: "write_file", arguments: "{{credential:api_key}}" })).toBe(false);
  });

  it("returns true when http_request arguments contain credential refs", () => {
    expect(
      hasCredentialRefs({
        name: "http_request",
        arguments: JSON.stringify({ headers: { Authorization: "{{credential:my_key}}" } }),
      }),
    ).toBe(true);
  });

  it("returns false when http_request arguments have no credential refs", () => {
    expect(
      hasCredentialRefs({
        name: "http_request",
        arguments: JSON.stringify({ url: "https://example.com" }),
      }),
    ).toBe(false);
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
