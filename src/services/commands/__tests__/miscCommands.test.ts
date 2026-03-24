import { describe, it, expect, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";

// ── cronCommands ──
import {
  listCronJobs,
  listCronJobsForAgent,
  createCronJob,
  getCronJob,
  updateCronJob,
  deleteCronJob,
  toggleCronJob,
  listCronRuns,
} from "../cronCommands";

// ── vaultCommands ──
import {
  vaultCreateNote,
  vaultReadNote,
  vaultUpdateNote,
  vaultDeleteNote,
  vaultListNotes,
  vaultSearch,
  vaultGetGraph,
  vaultGetBacklinks,
  vaultGetPath,
  vaultOpenInObsidian,
  vaultRebuildIndex,
  vaultArchiveNote,
  vaultListNotesWithDecay,
} from "../vaultCommands";

// ── toolCommands ──
import {
  getNativeTools,
  getDefaultToolConfig,
  readToolConfig,
  writeToolConfig,
  getWorkspacePath,
} from "../toolCommands";

// ── credentialCommands ──
import {
  listCredentials,
  addCredential,
  updateCredential,
  removeCredential,
} from "../credentialCommands";

// ── browserCommands ──
import { approveBrowserDomain } from "../browserCommands";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

// ═══════════════════════════════════════════════════════
// cronCommands
// ═══════════════════════════════════════════════════════

describe("cronCommands", () => {
  it("listCronJobs calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await listCronJobs();
    expect(invoke).toHaveBeenCalledWith("list_cron_jobs");
    expect(result).toEqual([]);
  });

  it("listCronJobsForAgent passes agentId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listCronJobsForAgent("a1");
    expect(invoke).toHaveBeenCalledWith("list_cron_jobs_for_agent", { agentId: "a1" });
  });

  it("createCronJob passes request object", async () => {
    const req = { agent_id: "a1", cron_expression: "0 * * * *", task: "check" };
    vi.mocked(invoke).mockResolvedValue({ id: "j1", ...req });
    const result = await createCronJob(req as any);
    expect(invoke).toHaveBeenCalledWith("create_cron_job", { request: req });
    expect(result).toEqual({ id: "j1", ...req });
  });

  it("getCronJob passes id", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "j1" });
    await getCronJob("j1");
    expect(invoke).toHaveBeenCalledWith("get_cron_job", { id: "j1" });
  });

  it("updateCronJob passes id and request", async () => {
    const req = { task: "updated task" };
    vi.mocked(invoke).mockResolvedValue({ id: "j1", task: "updated task" });
    await updateCronJob("j1", req as any);
    expect(invoke).toHaveBeenCalledWith("update_cron_job", { id: "j1", request: req });
  });

  it("deleteCronJob passes id", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await deleteCronJob("j1");
    expect(invoke).toHaveBeenCalledWith("delete_cron_job", { id: "j1" });
  });

  it("toggleCronJob passes id and enabled", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "j1", enabled: false });
    const result = await toggleCronJob("j1", false);
    expect(invoke).toHaveBeenCalledWith("toggle_cron_job", { id: "j1", enabled: false });
    expect(result).toEqual({ id: "j1", enabled: false });
  });

  it("listCronRuns passes jobId with null limit by default", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listCronRuns("j1");
    expect(invoke).toHaveBeenCalledWith("list_cron_runs", { jobId: "j1", limit: null });
  });

  it("listCronRuns passes limit when provided", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await listCronRuns("j1", 10);
    expect(invoke).toHaveBeenCalledWith("list_cron_runs", { jobId: "j1", limit: 10 });
  });
});

// ═══════════════════════════════════════════════════════
// vaultCommands
// ═══════════════════════════════════════════════════════

describe("vaultCommands", () => {
  it("vaultCreateNote passes destructured params with defaults", async () => {
    const params = { agentId: "a1", category: "fact", title: "Title", content: "Body" };
    vi.mocked(invoke).mockResolvedValue({ id: "n1", ...params });
    await vaultCreateNote(params);
    expect(invoke).toHaveBeenCalledWith("vault_create_note", {
      agentId: "a1",
      scope: "agent",
      category: "fact",
      title: "Title",
      content: "Body",
      tags: [],
      relatedIds: [],
    });
  });

  it("vaultCreateNote passes custom scope, tags, relatedIds", async () => {
    const params = {
      agentId: "a1",
      scope: "shared" as const,
      category: "fact",
      title: "T",
      content: "C",
      tags: ["tag1"],
      relatedIds: ["n0"],
    };
    vi.mocked(invoke).mockResolvedValue({ id: "n2" });
    await vaultCreateNote(params);
    expect(invoke).toHaveBeenCalledWith("vault_create_note", {
      agentId: "a1",
      scope: "shared",
      category: "fact",
      title: "T",
      content: "C",
      tags: ["tag1"],
      relatedIds: ["n0"],
    });
  });

  it("vaultReadNote passes noteId", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "n1", title: "Note" });
    await vaultReadNote("n1");
    expect(invoke).toHaveBeenCalledWith("vault_read_note", { noteId: "n1" });
  });

  it("vaultUpdateNote passes noteId, callerAgentId, and updates with null defaults", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "n1" });
    await vaultUpdateNote("n1", "a1", {});
    expect(invoke).toHaveBeenCalledWith("vault_update_note", {
      noteId: "n1",
      callerAgentId: "a1",
      title: null,
      content: null,
      tags: null,
      confidence: null,
      addLinks: null,
    });
  });

  it("vaultUpdateNote passes provided update fields", async () => {
    vi.mocked(invoke).mockResolvedValue({ id: "n1" });
    await vaultUpdateNote("n1", "a1", {
      title: "New Title",
      content: "New Content",
      tags: ["updated"],
      confidence: 0.9,
      addLinks: ["n2"],
    });
    expect(invoke).toHaveBeenCalledWith("vault_update_note", {
      noteId: "n1",
      callerAgentId: "a1",
      title: "New Title",
      content: "New Content",
      tags: ["updated"],
      confidence: 0.9,
      addLinks: ["n2"],
    });
  });

  it("vaultDeleteNote passes noteId with default caller", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await vaultDeleteNote("n1");
    expect(invoke).toHaveBeenCalledWith("vault_delete_note", { noteId: "n1", caller: "user" });
  });

  it("vaultDeleteNote passes custom caller", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await vaultDeleteNote("n1", "a1");
    expect(invoke).toHaveBeenCalledWith("vault_delete_note", { noteId: "n1", caller: "a1" });
  });

  it("vaultListNotes passes null agentId by default", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultListNotes();
    expect(invoke).toHaveBeenCalledWith("vault_list_notes", { agentId: null });
  });

  it("vaultListNotes passes agentId when provided", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultListNotes("a1");
    expect(invoke).toHaveBeenCalledWith("vault_list_notes", { agentId: "a1" });
  });

  it("vaultSearch passes query with defaults", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultSearch("search term");
    expect(invoke).toHaveBeenCalledWith("vault_search", {
      query: "search term",
      scope: "all",
      agentId: null,
    });
  });

  it("vaultSearch passes custom scope and agentId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultSearch("term", "self", "a1");
    expect(invoke).toHaveBeenCalledWith("vault_search", {
      query: "term",
      scope: "self",
      agentId: "a1",
    });
  });

  it("vaultGetGraph passes defaults", async () => {
    vi.mocked(invoke).mockResolvedValue({ nodes: [], edges: [] });
    await vaultGetGraph();
    expect(invoke).toHaveBeenCalledWith("vault_get_graph", {
      agentId: null,
      depth: null,
      includeShared: true,
    });
  });

  it("vaultGetGraph passes custom args", async () => {
    vi.mocked(invoke).mockResolvedValue({ nodes: [], edges: [] });
    await vaultGetGraph("a1", 3, false);
    expect(invoke).toHaveBeenCalledWith("vault_get_graph", {
      agentId: "a1",
      depth: 3,
      includeShared: false,
    });
  });

  it("vaultGetBacklinks passes noteId", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultGetBacklinks("n1");
    expect(invoke).toHaveBeenCalledWith("vault_get_backlinks", { noteId: "n1" });
  });

  it("vaultGetPath calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("/path/to/vault");
    const result = await vaultGetPath();
    expect(invoke).toHaveBeenCalledWith("vault_get_path");
    expect(result).toBe("/path/to/vault");
  });

  it("vaultOpenInObsidian calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await vaultOpenInObsidian();
    expect(invoke).toHaveBeenCalledWith("vault_open_in_obsidian");
  });

  it("vaultRebuildIndex calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue({ total: 42 });
    const result = await vaultRebuildIndex();
    expect(invoke).toHaveBeenCalledWith("vault_rebuild_index");
    expect(result).toEqual({ total: 42 });
  });

  it("vaultArchiveNote passes noteId and agentId", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await vaultArchiveNote("n1", "a1");
    expect(invoke).toHaveBeenCalledWith("vault_archive_note", { noteId: "n1", agentId: "a1" });
  });

  it("vaultListNotesWithDecay passes all args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultListNotesWithDecay("a1", "fact", 0.1, 0.5, 30);
    expect(invoke).toHaveBeenCalledWith("vault_list_notes_with_decay", {
      agentId: "a1",
      category: "fact",
      lambda: 0.1,
      minConfidence: 0.5,
      staleDays: 30,
    });
  });

  it("vaultListNotesWithDecay accepts null agentId and category", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    await vaultListNotesWithDecay(null, null, 0.2, 0.3, 7);
    expect(invoke).toHaveBeenCalledWith("vault_list_notes_with_decay", {
      agentId: null,
      category: null,
      lambda: 0.2,
      minConfidence: 0.3,
      staleDays: 7,
    });
  });
});

// ═══════════════════════════════════════════════════════
// toolCommands
// ═══════════════════════════════════════════════════════

describe("toolCommands", () => {
  it("getNativeTools calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await getNativeTools();
    expect(invoke).toHaveBeenCalledWith("get_native_tools");
    expect(result).toEqual([]);
  });

  it("getDefaultToolConfig calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue("config");
    const result = await getDefaultToolConfig();
    expect(invoke).toHaveBeenCalledWith("get_default_tool_config");
    expect(result).toBe("config");
  });

  it("readToolConfig passes folderName", async () => {
    vi.mocked(invoke).mockResolvedValue("config content");
    const result = await readToolConfig("my-agent");
    expect(invoke).toHaveBeenCalledWith("read_tool_config", { folderName: "my-agent" });
    expect(result).toBe("config content");
  });

  it("writeToolConfig passes folderName and config", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await writeToolConfig("my-agent", "new config");
    expect(invoke).toHaveBeenCalledWith("write_tool_config", {
      folderName: "my-agent",
      config: "new config",
    });
  });

  it("getWorkspacePath passes conversationId", async () => {
    vi.mocked(invoke).mockResolvedValue("/workspace/c1");
    const result = await getWorkspacePath("c1");
    expect(invoke).toHaveBeenCalledWith("get_workspace_path", { conversationId: "c1" });
    expect(result).toBe("/workspace/c1");
  });
});

// ═══════════════════════════════════════════════════════
// credentialCommands
// ═══════════════════════════════════════════════════════

describe("credentialCommands", () => {
  it("listCredentials calls invoke with no extra args", async () => {
    vi.mocked(invoke).mockResolvedValue([]);
    const result = await listCredentials();
    expect(invoke).toHaveBeenCalledWith("list_credentials");
    expect(result).toEqual([]);
  });

  it("addCredential passes request object with allowed_hosts", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await addCredential("cred1", "API Key", "secret123", ["example.com"]);
    expect(invoke).toHaveBeenCalledWith("add_credential", {
      request: {
        id: "cred1",
        name: "API Key",
        value: "secret123",
        allowed_hosts: ["example.com"],
      },
    });
  });

  it("updateCredential passes request with null defaults", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateCredential("cred1");
    expect(invoke).toHaveBeenCalledWith("update_credential", {
      request: {
        id: "cred1",
        name: null,
        value: null,
        allowed_hosts: null,
      },
    });
  });

  it("updateCredential passes provided optional fields", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await updateCredential("cred1", "New Name", "new-secret", ["new.host"]);
    expect(invoke).toHaveBeenCalledWith("update_credential", {
      request: {
        id: "cred1",
        name: "New Name",
        value: "new-secret",
        allowed_hosts: ["new.host"],
      },
    });
  });

  it("removeCredential passes id", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await removeCredential("cred1");
    expect(invoke).toHaveBeenCalledWith("remove_credential", { id: "cred1" });
  });
});

// ═══════════════════════════════════════════════════════
// browserCommands
// ═══════════════════════════════════════════════════════

describe("browserCommands", () => {
  it("approveBrowserDomain passes conversationId and domain", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined);
    await approveBrowserDomain("c1", "example.com");
    expect(invoke).toHaveBeenCalledWith("approve_browser_domain", {
      conversationId: "c1",
      domain: "example.com",
    });
  });
});
