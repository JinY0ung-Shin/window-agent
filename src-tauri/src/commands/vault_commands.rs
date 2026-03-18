use crate::vault::links::LinkRef;
use crate::vault::graph::GraphData;
use crate::vault::search::SearchResult;
use crate::vault::{IndexStats, VaultManager, VaultNote, VaultNoteSummary};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// Thread-safe wrapper for VaultManager used as Tauri managed state.
pub type VaultState = Mutex<VaultManager>;

// ── Note CRUD ──

#[tauri::command]
pub fn vault_create_note(
    vault: State<'_, VaultState>,
    agent_id: String,
    scope: Option<String>,
    category: String,
    title: String,
    content: String,
    tags: Vec<String>,
    related_ids: Vec<String>,
) -> Result<VaultNote, String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.create_note(
        &agent_id,
        scope.as_deref(),
        &category,
        &title,
        &content,
        tags,
        related_ids,
    )
}

#[tauri::command]
pub fn vault_read_note(
    vault: State<'_, VaultState>,
    note_id: String,
) -> Result<VaultNote, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.read_note(&note_id)
}

#[tauri::command]
pub fn vault_update_note(
    vault: State<'_, VaultState>,
    note_id: String,
    caller_agent_id: String,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
    confidence: Option<f64>,
    add_links: Option<Vec<String>>,
) -> Result<VaultNote, String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.update_note(
        &note_id,
        &caller_agent_id,
        title.as_deref(),
        content.as_deref(),
        tags,
        confidence,
        add_links,
    )
}

#[tauri::command]
pub fn vault_delete_note(
    vault: State<'_, VaultState>,
    note_id: String,
    caller: String,
) -> Result<(), String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.delete_note(&note_id, &caller)
}

#[tauri::command]
pub fn vault_list_notes(
    vault: State<'_, VaultState>,
    agent_id: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Vec<VaultNoteSummary>, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    Ok(vm.list_notes(
        agent_id.as_deref(),
        category.as_deref(),
        tags.as_deref(),
    ))
}

// ── Search + Graph ──

#[tauri::command]
pub fn vault_search(
    vault: State<'_, VaultState>,
    query: String,
    agent_id: Option<String>,
    scope: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<SearchResult>, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let mut results = vm.search(&query, agent_id.as_deref(), scope.as_deref());
    if let Some(max) = limit {
        results.truncate(max);
    }
    Ok(results)
}

#[tauri::command]
pub fn vault_get_graph(
    vault: State<'_, VaultState>,
    agent_id: Option<String>,
    depth: Option<u32>,
    include_shared: bool,
) -> Result<GraphData, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    Ok(vm.get_graph(agent_id.as_deref(), depth, include_shared))
}

#[tauri::command]
pub fn vault_get_backlinks(
    vault: State<'_, VaultState>,
    note_id: String,
) -> Result<Vec<LinkRef>, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    Ok(vm.get_backlinks(&note_id))
}

// ── Vault management ──

#[tauri::command]
pub fn vault_get_path(
    vault: State<'_, VaultState>,
) -> Result<String, String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    Ok(vm.get_vault_path().to_string_lossy().to_string())
}

#[tauri::command]
pub fn vault_open_in_obsidian(
    app: AppHandle,
    vault: State<'_, VaultState>,
) -> Result<(), String> {
    let vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    let vault_path = vm.get_vault_path();

    // Derive vault name from directory name
    let vault_name = vault_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("vault");

    // Use obsidian:// URI scheme to open the vault
    let uri = format!("obsidian://open?vault={}", urlencoding::encode(vault_name));

    app.opener()
        .open_url(&uri, None::<&str>)
        .map_err(|e| format!("Failed to open Obsidian: {e}"))?;
    Ok(())
}

#[tauri::command]
pub fn vault_rebuild_index(
    vault: State<'_, VaultState>,
) -> Result<IndexStats, String> {
    let mut vm = vault.lock().map_err(|_| "Vault lock failed".to_string())?;
    vm.rebuild_index()
}

