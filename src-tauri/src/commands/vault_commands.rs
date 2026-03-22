use crate::error::AppError;
use crate::vault::links::LinkRef;
use crate::vault::graph::GraphData;
use crate::vault::search::SearchResult;
use crate::vault::{IndexStats, VaultManager, VaultNote, VaultNoteSummary};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

/// VaultNoteSummary enriched with compute-on-read confidence decay.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultNoteSummaryWithDecay {
    #[serde(flatten)]
    pub base: VaultNoteSummary,
    pub effective_confidence: f64,
    pub age_days: f64,
    pub is_stale: bool,
}

/// Thread-safe wrapper for VaultManager used as Tauri managed state.
pub type VaultState = Mutex<VaultManager>;

// ── Internal param structs (keeps Tauri command signatures under clippy threshold) ──

#[derive(Deserialize)]
struct CreateNoteParams {
    agent_id: String,
    scope: Option<String>,
    category: String,
    title: String,
    content: String,
    tags: Vec<String>,
    related_ids: Vec<String>,
}

#[derive(Deserialize)]
struct UpdateNoteParams {
    note_id: String,
    caller_agent_id: String,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
    confidence: Option<f64>,
    add_links: Option<Vec<String>>,
}

fn create_note_impl(vm: &mut VaultManager, p: CreateNoteParams) -> Result<VaultNote, AppError> {
    vm.create_note(
        &p.agent_id,
        p.scope.as_deref(),
        &p.category,
        &p.title,
        &p.content,
        p.tags,
        p.related_ids,
    )
    .map_err(AppError::Vault)
}

fn update_note_impl(vm: &mut VaultManager, p: UpdateNoteParams) -> Result<VaultNote, AppError> {
    vm.update_note(
        &p.note_id,
        &p.caller_agent_id,
        p.title.as_deref(),
        p.content.as_deref(),
        p.tags,
        p.confidence,
        p.add_links,
    )
    .map_err(AppError::Vault)
}

// ── Note CRUD ──

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn vault_create_note(
    vault: State<'_, VaultState>,
    agent_id: String,
    scope: Option<String>,
    category: String,
    title: String,
    content: String,
    tags: Vec<String>,
    related_ids: Vec<String>,
) -> Result<VaultNote, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    create_note_impl(&mut vm, CreateNoteParams {
        agent_id, scope, category, title, content, tags, related_ids,
    })
}

#[tauri::command]
pub fn vault_read_note(
    vault: State<'_, VaultState>,
    note_id: String,
) -> Result<VaultNote, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    vm.read_note(&note_id).map_err(AppError::Vault)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn vault_update_note(
    vault: State<'_, VaultState>,
    note_id: String,
    caller_agent_id: String,
    title: Option<String>,
    content: Option<String>,
    tags: Option<Vec<String>>,
    confidence: Option<f64>,
    add_links: Option<Vec<String>>,
) -> Result<VaultNote, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    update_note_impl(&mut vm, UpdateNoteParams {
        note_id, caller_agent_id, title, content, tags, confidence, add_links,
    })
}

#[tauri::command]
pub fn vault_delete_note(
    vault: State<'_, VaultState>,
    note_id: String,
    caller: String,
) -> Result<(), AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    vm.delete_note(&note_id, &caller).map_err(AppError::Vault)
}

#[tauri::command]
pub fn vault_list_notes(
    vault: State<'_, VaultState>,
    agent_id: Option<String>,
    category: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Vec<VaultNoteSummary>, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
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
) -> Result<Vec<SearchResult>, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
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
) -> Result<GraphData, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    Ok(vm.get_graph(agent_id.as_deref(), depth, include_shared))
}

#[tauri::command]
pub fn vault_get_backlinks(
    vault: State<'_, VaultState>,
    note_id: String,
) -> Result<Vec<LinkRef>, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    Ok(vm.get_backlinks(&note_id))
}

// ── Vault management ──

#[tauri::command]
pub fn vault_get_path(
    vault: State<'_, VaultState>,
) -> Result<String, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    Ok(vm.get_vault_path().to_string_lossy().to_string())
}

#[tauri::command]
pub fn vault_open_in_obsidian(
    app: AppHandle,
    vault: State<'_, VaultState>,
) -> Result<(), AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
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
        .map_err(|e| AppError::Io(format!("Failed to open Obsidian: {e}")))?;
    Ok(())
}

#[tauri::command]
pub fn vault_rebuild_index(
    vault: State<'_, VaultState>,
) -> Result<IndexStats, AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    vm.rebuild_index().map_err(AppError::Vault)
}

/// Archive a single note by ID.
#[tauri::command]
pub fn vault_archive_note(
    vault: State<'_, VaultState>,
    note_id: String,
    agent_id: String,
) -> Result<(), AppError> {
    let mut vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    vm.archive_note(&note_id, &agent_id).map_err(AppError::Vault)
}

/// List notes with compute-on-read confidence decay.
/// Does NOT modify any notes — pure read operation.
#[tauri::command]
pub fn vault_list_notes_with_decay(
    vault: State<'_, VaultState>,
    agent_id: Option<String>,
    category: Option<String>,
    lambda: f64,
    min_confidence: f64,
    stale_days: f64,
) -> Result<Vec<VaultNoteSummaryWithDecay>, AppError> {
    let vm = vault.lock().map_err(|_| AppError::Lock("Vault lock failed".into()))?;
    let notes = vm.list_notes(agent_id.as_deref(), category.as_deref(), None);
    let now = Utc::now();

    let result = notes
        .into_iter()
        .map(|note| {
            let age_days = chrono::DateTime::parse_from_rfc3339(&note.updated)
                .map(|dt| (now - dt.with_timezone(&Utc)).num_seconds() as f64 / 86400.0)
                .unwrap_or(0.0);

            let effective_confidence =
                (note.confidence * (-lambda * age_days).exp()).max(min_confidence);
            let is_stale = age_days > stale_days;

            VaultNoteSummaryWithDecay {
                base: note,
                effective_confidence,
                age_days,
                is_stale,
            }
        })
        .collect();

    Ok(result)
}
