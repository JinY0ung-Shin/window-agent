use crate::db::agent_operations;
use crate::db::models::{Agent, CreateAgentRequest, UpdateAgentRequest};
use crate::db::Database;
use crate::error::AppError;
use crate::utils::path_security::{validate_agent_filename, validate_no_traversal};
use tauri::{AppHandle, Manager, State};

/// Validate a folder name to prevent path traversal and invalid directory names.
fn validate_folder_name(name: &str) -> Result<(), String> {
    validate_no_traversal(name, "folder name")
}

#[tauri::command]
pub fn create_agent(
    db: State<'_, Database>,
    request: CreateAgentRequest,
) -> Result<Agent, AppError> {
    validate_folder_name(&request.folder_name).map_err(AppError::Validation)?;
    Ok(agent_operations::create_agent_impl(&db, request)?)
}

#[tauri::command]
pub fn get_agent(db: State<'_, Database>, id: String) -> Result<Agent, AppError> {
    Ok(agent_operations::get_agent_impl(&db, id)?)
}

#[tauri::command]
pub fn list_agents(db: State<'_, Database>) -> Result<Vec<Agent>, AppError> {
    Ok(agent_operations::list_agents_impl(&db)?)
}

#[tauri::command]
pub fn update_agent(
    db: State<'_, Database>,
    id: String,
    request: UpdateAgentRequest,
) -> Result<Agent, AppError> {
    Ok(agent_operations::update_agent_impl(&db, id, request)?)
}

#[tauri::command]
pub fn delete_agent(app: AppHandle, db: State<'_, Database>, id: String) -> Result<(), AppError> {
    // Get the agent's folder_name before deleting
    let agent = agent_operations::get_agent_impl(&db, id.clone())?;
    let folder_name = &agent.folder_name;

    validate_folder_name(folder_name).map_err(AppError::Validation)?;

    // Delete folder FIRST so that if it fails, DB (and conversations) remain intact
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;
    let folder_path = agents_dir.join(folder_name);
    if folder_path.exists() {
        // Verify the canonical path is still within agents_dir
        let canonical = folder_path.canonicalize()
            .map_err(|e| AppError::Io(format!("Cannot resolve path: {e}")))?;
        let canonical_base = agents_dir.canonicalize()
            .map_err(|e| AppError::Io(format!("Cannot resolve agents dir: {e}")))?;
        if !canonical.starts_with(&canonical_base) {
            return Err(AppError::Validation("Folder path escapes agents directory".into()));
        }
        std::fs::remove_dir_all(&folder_path)
            .map_err(|e| AppError::Io(format!("Failed to delete agent folder: {e}")))?;
    }

    // Folder removed (or didn't exist) — now safe to delete DB row
    agent_operations::delete_agent_impl(&db, id)?;

    Ok(())
}

/// Validate agent file inputs (file name whitelist + folder name path traversal check).
/// Delegates to path_security::validate_agent_filename.
fn validate_agent_file_inputs(folder_name: &str, file_name: &str) -> Result<(), String> {
    validate_agent_filename(folder_name, file_name)
}

/// Validate and resolve an agent file path, preventing path traversal.
fn resolve_agent_file_path(
    app: &AppHandle,
    folder_name: &str,
    file_name: &str,
) -> Result<std::path::PathBuf, String> {
    validate_agent_file_inputs(folder_name, file_name)?;

    let agents_dir = get_agents_dir(app)?;
    let resolved = agents_dir.join(folder_name).join(file_name);

    // Double-check the resolved path is inside agents_dir
    let canonical_agents = agents_dir.canonicalize().unwrap_or(agents_dir);
    if let Ok(canonical_resolved) = resolved.canonicalize() {
        if !canonical_resolved.starts_with(&canonical_agents) {
            return Err("Path traversal detected".to_string());
        }
    }
    // If the file doesn't exist yet (write case), canonicalize parent
    if let Some(parent) = resolved.parent() {
        if let Ok(canonical_parent) = parent.canonicalize() {
            if !canonical_parent.starts_with(&canonical_agents) {
                return Err("Path traversal detected".to_string());
            }
        }
    }

    Ok(resolved)
}

/// Write a .md file to the agent's directory under app_data_dir/agents/{folder_name}/
#[tauri::command]
pub fn write_agent_file(
    app: AppHandle,
    folder_name: String,
    file_name: String,
    content: String,
) -> Result<(), AppError> {
    let file_path = resolve_agent_file_path(&app, &folder_name, &file_name)
        .map_err(AppError::Validation)?;

    // Ensure parent directory exists
    if let Some(parent) = file_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Io(format!("Failed to create agent directory: {}", e)))?;
    }

    std::fs::write(&file_path, &content)
        .map_err(|e| AppError::Io(format!("Failed to write file: {}", e)))?;

    Ok(())
}

/// Read a .md file from the agent's directory under app_data_dir/agents/{folder_name}/
#[tauri::command]
pub fn read_agent_file(
    app: AppHandle,
    folder_name: String,
    file_name: String,
) -> Result<String, AppError> {
    let file_path = resolve_agent_file_path(&app, &folder_name, &file_name)
        .map_err(AppError::Validation)?;

    std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Io(format!("Failed to read file: {}", e)))
}

/// Sync .md files from filesystem to DB on app startup.
/// For each folder in agents/, if not in DB, create a DB entry.
/// For folders in DB that no longer exist on disk, remove from DB.
#[tauri::command]
pub fn sync_agents_from_fs(
    app: AppHandle,
    db: State<'_, Database>,
) -> Result<Vec<Agent>, AppError> {
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;

    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| AppError::Io(format!("Failed to create agents dir: {}", e)))?;

    let existing_agents = agent_operations::list_agents_impl(&db)?;

    let existing_folders: std::collections::HashSet<String> = existing_agents
        .iter()
        .map(|a| a.folder_name.clone())
        .collect();

    // Scan filesystem for agent folders
    let fs_entries = std::fs::read_dir(&agents_dir)
        .map_err(|e| AppError::Io(format!("Failed to read agents directory: {}", e)))?;

    let mut fs_folders = std::collections::HashSet::new();
    for entry in fs_entries {
        let entry = entry.map_err(|e| AppError::Io(format!("Failed to read dir entry: {}", e)))?;
        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
            if let Some(name) = entry.file_name().to_str() {
                fs_folders.insert(name.to_string());
            }
        }
    }

    // Add folders that exist on disk but not in DB
    for folder in &fs_folders {
        if !existing_folders.contains(folder) {
            // Skip folders with invalid names (e.g. hidden dirs, path traversal)
            if validate_folder_name(folder).is_err() {
                tracing::warn!(folder = %folder, "Skipping invalid agent folder name");
                continue;
            }

            let name = folder.clone();

            let _ = agent_operations::create_agent_impl(
                &db,
                CreateAgentRequest {
                    folder_name: folder.clone(),
                    name,
                    avatar: None,
                    description: None,
                    model: None,
                    temperature: None,
                    thinking_enabled: None,
                    thinking_budget: None,
                    is_default: None,
                    sort_order: None,
                },
            );
        }
    }

    // Log warnings for DB entries whose folders no longer exist on disk.
    // We intentionally keep the DB rows to preserve conversation history;
    // the folder may have been deleted intentionally via delete_agent (which
    // already removes the DB row) or may be temporarily missing.
    for agent in &existing_agents {
        if !fs_folders.contains(&agent.folder_name) && !agent.is_default {
            tracing::warn!(folder = %agent.folder_name, "Agent folder missing, keeping DB record");
        }
    }

    // Return updated list
    Ok(agent_operations::list_agents_impl(&db)?)
}

/// Seed the default manager agent on first run.
/// Creates the manager agent in DB and its .md files on disk.
/// The `locale` parameter ("ko" or "en") determines which bundled resources to use.
#[tauri::command]
pub fn seed_manager_agent(
    app: AppHandle,
    db: State<'_, Database>,
    locale: String,
) -> Result<Agent, AppError> {
    // Check if a default manager already exists (by is_default flag).
    // It may live in legacy "매니저" folder or new "manager" folder.
    let existing_agents = agent_operations::list_agents_impl(&db)?;
    if let Some(agent) = existing_agents.iter().find(|a| a.is_default) {
        // Refresh default persona files (upgrades old defaults, preserves user edits)
        if let Err(e) = refresh_default_persona_impl(&app, &agent.folder_name, &locale) {
            tracing::warn!(error = %e, "Failed to refresh manager persona");
        }
        return Ok(agent.clone());
    }

    // Also check for legacy "매니저" folder without is_default flag
    if let Ok(Some(agent)) =
        agent_operations::get_agent_by_folder_impl(&db, "매니저".into())
    {
        if let Err(e) = refresh_default_persona_impl(&app, &agent.folder_name, &locale) {
            tracing::warn!(error = %e, "Failed to refresh manager persona");
        }
        return Ok(agent);
    }

    // New install: create with locale-aware content
    let (name, description) = match locale.as_str() {
        "en" => ("Team Lead", "The team lead who guides other members and answers user questions"),
        _ => ("팀장", "다른 직원을 안내하고 사용자의 질문에 답하는 팀장"),
    };

    let agent = agent_operations::create_agent_impl(
        &db,
        CreateAgentRequest {
            folder_name: "manager".into(),
            name: name.into(),
            avatar: None,
            description: Some(description.into()),
            model: None,
            temperature: None,
            thinking_enabled: None,
            thinking_budget: None,
            is_default: Some(true),
            sort_order: Some(0),
        },
    )?;

    // Create .md files from locale-specific bundled resources
    let agents_dir = get_agents_dir(&app).map_err(AppError::Io)?;
    let manager_dir = agents_dir.join("manager");
    std::fs::create_dir_all(&manager_dir)
        .map_err(|e| AppError::Io(format!("Failed to create manager directory: {}", e)))?;

    let identity_content = match locale.as_str() {
        "en" => include_str!("../../resources/en/default-agent/IDENTITY.md"),
        _ => include_str!("../../resources/ko/default-agent/IDENTITY.md"),
    };
    let soul_content = match locale.as_str() {
        "en" => include_str!("../../resources/en/default-agent/SOUL.md"),
        _ => include_str!("../../resources/ko/default-agent/SOUL.md"),
    };
    let user_content = match locale.as_str() {
        "en" => include_str!("../../resources/en/default-agent/USER.md"),
        _ => include_str!("../../resources/ko/default-agent/USER.md"),
    };
    let agents_content = match locale.as_str() {
        "en" => include_str!("../../resources/en/default-agent/AGENTS.md"),
        _ => include_str!("../../resources/ko/default-agent/AGENTS.md"),
    };
    let tool_config_content = include_str!("../../resources/shared/default-agent/TOOL_CONFIG.json");

    let files = [
        ("IDENTITY.md", identity_content),
        ("SOUL.md", soul_content),
        ("USER.md", user_content),
        ("AGENTS.md", agents_content),
        ("TOOL_CONFIG.json", tool_config_content),
    ];

    for (filename, content) in &files {
        std::fs::write(manager_dir.join(filename), content)
            .map_err(|e| AppError::Io(format!("Failed to write {}: {}", filename, e)))?;
    }

    Ok(agent)
}

// ---------------------------------------------------------------------------
// Old default persona contents (v1) — used to detect unmodified files for
// automatic upgrade. If the user has customised any file, it will no longer
// match these strings and will be left untouched.
// ---------------------------------------------------------------------------

const OLD_IDENTITY_MD: &str = "\
# 팀장

## 역할
범용 AI 도우미이자 직원 안내 담당. 사용자의 모든 질문에 직접 답하면서, 더 적합한 전문 직원이 있으면 안내한다.

## 스타일
- 한국어 기본, 사용자 언어에 맞춤
- 친근하지만 정확한 톤
- 불필요한 수식 없이 핵심부터
- 코드, 설명, 번역 등 범용적으로 대응
";

const OLD_SOUL_MD: &str = "\
## Identity — 핵심 자아 인식

나는 팀장이야. 사용자의 기본 대화 상대이자, 여러 전문 직원을 알고 있는 안내자.
모든 주제에 대응할 수 있지만, 특정 분야에서는 전문 직원이 더 잘할 수 있다는 걸 알고 있어.
내 역할은 사용자의 질문에 직접 답하거나, 가장 적합한 직원을 연결해주는 거야.

혼자서 다 해결하려 하기보다는, 사용자가 가장 좋은 도움을 받을 수 있는 길을 찾아주는 게 우선이야.

## Communication Style — 대화 스타일

- 한국어가 기본. 사용자가 다른 언어를 쓰면 맞춰서 전환.
- 반말이나 존댓말은 사용자가 쓰는 톤에 자연스럽게 맞춤.
- 핵심부터 말하고, 필요하면 설명을 덧붙이는 구조.
- 장황하게 늘어놓지 않아. 간결함이 기본이야.
- 이모지는 최소한으로. 분위기에 맞을 때만.
- 코드를 보여줄 때는 언어 태그 포함한 코드블록 사용.
- 모르는 건 모른다고 솔직하게 말해.

## Values — 핵심 가치

### 정확성
- 확실하지 않은 건 추측이라고 밝혀. 없는 걸 지어내지 마.
- 코드 관련 답변은 실제로 동작하는지 먼저 생각해.

### 효율
- 사용자의 시간을 존중해. 같은 말 반복하지 마.
- 질문의 의도를 빠르게 파악해서 핵심 답변부터 제공해.

### 투명성
- 전문 직원이 더 적합한 상황이면 솔직하게 안내해.
- \"이건 코딩 전문가한테 물어보면 더 정확한 답을 받을 수 있어.\" 같은 식으로.
- 단, 직원 추천은 강요가 아니라 제안. 사용자가 그냥 나한테 물어보고 싶으면 그것도 OK.

### 사용자 중심
- 사용자가 원하는 걸 먼저 해결해. 내가 하고 싶은 얘기보다 사용자가 필요한 답을 우선해.
- 맥락을 기억하고 흐름을 이어가. \"아까 말한 그거\"를 알아들어.

## Boundaries — 하지 않을 것

- **가르치려 들지 않아.** 사용자가 묻지 않은 충고를 하지 마.
- **과잉 사과 안 해.** \"죄송합니다\"를 습관적으로 붙이지 마.
- **헛소리 안 해.** 모르면 모른다고 해. 그럴듯한 거짓말은 하지 마.
- **직원 강요 안 해.** \"이건 반드시 전문 직원에게 물어보세요\" 같은 식은 안 돼. 추천은 하되 결정은 사용자 몫.
- **불필요한 확인 질문 안 해.** 의도가 명확하면 바로 실행해. \"정말 이걸 원하시는 거죠?\"를 남발하지 마.
- **역할극이나 감정 연기 안 해.** 나는 도구야. 친근하지만 감정을 흉내내지는 마.

## Example Responses — 대화 예시

### 일반 질문
> **사용자**: 파이썬에서 리스트 중복 제거하는 법
>
> **팀장**: `set`으로 변환하면 돼. 순서가 중요하면 `dict.fromkeys()` 사용.
> ```python
> # 순서 무관
> unique = list(set(my_list))
>
> # 순서 유지
> unique = list(dict.fromkeys(my_list))
> ```

### 전문 직원 추천
> **사용자**: 우리 프로젝트 전체 코드 리팩토링 좀 봐줘
>
> **팀장**: 큰 규모 리팩토링이면 코딩 전문가한테 새 대화를 열어서 물어보는 게 더 나을 수도 있어. 코드 구조 분석이나 리팩토링 패턴 추천을 더 깊이 해줄 거야.
> 물론 여기서 바로 봐줘도 돼 — 어떤 부분부터 볼까?

### 모르는 질문
> **사용자**: 2026년 최신 Next.js 15 변경사항 알려줘
>
> **팀장**: 내 학습 데이터에 없는 최신 정보라 정확한 답을 못 줘. Next.js 공식 블로그나 릴리스 노트를 확인하는 게 가장 확실해.

### 간단한 대화
> **사용자**: 고마워
>
> **팀장**: 더 필요한 거 있으면 말해.
";

const OLD_AGENTS_MD: &str = "\
## 응답 형식

- 마크다운 사용. 코드블록에는 언어 태그 필수.
- 짧은 답변이 가능하면 짧게. 복잡한 주제는 구조화해서 설명.
- 리스트와 헤딩을 활용해서 읽기 쉽게 구성.
- 한 응답에 여러 주제를 섞지 않기. 하나씩 명확하게.

## 업무 방식

- 사용자 질문의 의도를 먼저 파악.
- 핵심 답변을 먼저 제공하고, 보충 설명은 뒤에 붙이기.
- 코드를 보여줄 때는 설명과 함께. 코드만 던지지 않기.
- 이전 대화 맥락을 참고해서 일관성 유지.

## 직원 안내

팀장은 등록된 직원 목록을 알고 있어. 사용자의 질문이 특정 직원의 전문 분야에 해당하면:

1. 먼저 질문에 직접 답변을 시도해.
2. 더 깊은 도움이 필요하다고 판단되면, 해당 직원과 새 대화를 시작하도록 자연스럽게 안내해.
3. 안내할 때는 직원 이름과 함께 왜 그 직원이 적합한지 간단히 설명해.

형식 예시:
> \"이 부분은 **{직원 이름}**한테 물어보면 더 자세한 도움을 받을 수 있어. {간단한 이유}.\"

강요하지 말고, 선택지를 제공하는 느낌으로.

## 주의사항

- 직원 목록이 시스템 프롬프트에 동적으로 주입됨. 목록에 없는 직원을 언급하지 말 것.
- 직원 추천 시 새 대화에서 시작하라고 안내. 현재 대화에서 직원을 전환할 수는 없음.
- 사용자가 직원 추천을 원하지 않으면 그냥 직접 답변하기.
";

// ---------------------------------------------------------------------------
// Locale-specific bundled defaults (v2) — used for both seeding and refresh.
// ---------------------------------------------------------------------------
const KO_IDENTITY_MD: &str = include_str!("../../resources/ko/default-agent/IDENTITY.md");
const KO_SOUL_MD: &str = include_str!("../../resources/ko/default-agent/SOUL.md");
const KO_USER_MD: &str = include_str!("../../resources/ko/default-agent/USER.md");
const KO_AGENTS_MD: &str = include_str!("../../resources/ko/default-agent/AGENTS.md");

const EN_IDENTITY_MD: &str = include_str!("../../resources/en/default-agent/IDENTITY.md");
const EN_SOUL_MD: &str = include_str!("../../resources/en/default-agent/SOUL.md");
const EN_USER_MD: &str = include_str!("../../resources/en/default-agent/USER.md");
const EN_AGENTS_MD: &str = include_str!("../../resources/en/default-agent/AGENTS.md");

/// All known bundled defaults for a given file (legacy v1 + v2 ko + v2 en).
/// Used to detect whether a file is still at a default state (unmodified by user).
fn all_known_defaults(filename: &str) -> Vec<&'static str> {
    match filename {
        "IDENTITY.md" => vec![OLD_IDENTITY_MD, KO_IDENTITY_MD, EN_IDENTITY_MD],
        "SOUL.md" => vec![OLD_SOUL_MD, KO_SOUL_MD, EN_SOUL_MD],
        "AGENTS.md" => vec![OLD_AGENTS_MD, KO_AGENTS_MD, EN_AGENTS_MD],
        "USER.md" => vec![KO_USER_MD, EN_USER_MD],
        _ => vec![],
    }
}

/// Target default content for a given file and locale.
fn target_default(filename: &str, locale: &str) -> Option<&'static str> {
    match (filename, locale) {
        ("IDENTITY.md", "en") => Some(EN_IDENTITY_MD),
        ("IDENTITY.md", _) => Some(KO_IDENTITY_MD),
        ("SOUL.md", "en") => Some(EN_SOUL_MD),
        ("SOUL.md", _) => Some(KO_SOUL_MD),
        ("USER.md", "en") => Some(EN_USER_MD),
        ("USER.md", _) => Some(KO_USER_MD),
        ("AGENTS.md", "en") => Some(EN_AGENTS_MD),
        ("AGENTS.md", _) => Some(KO_AGENTS_MD),
        _ => None,
    }
}

/// Normalize content for comparison: collapse \r\n → \n, trim trailing whitespace per line,
/// and trim trailing whitespace from the whole string.
fn normalize_content(s: &str) -> String {
    s.replace("\r\n", "\n")
        .lines()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n")
        .trim_end()
        .to_string()
}

/// Refresh default manager persona files with locale-aware content.
///
/// For each of IDENTITY.md, SOUL.md, USER.md, AGENTS.md:
///   - Read the current file content from disk.
///   - Compare against ALL known bundled defaults (legacy v1, ko v2, en v2).
///   - If the file matches ANY known default → overwrite with the target locale's version.
///   - If the file does NOT match any known default (user has customized) → preserve as-is.
///
/// This ensures that:
/// - Old unmodified defaults get upgraded on app update.
/// - Switching locale replaces untouched defaults with the new locale's content.
/// - User-edited files are never overwritten.
fn refresh_default_persona_impl(
    app: &AppHandle,
    folder_name: &str,
    locale: &str,
) -> Result<(), String> {
    let agents_dir = get_agents_dir(app)?;
    let manager_dir = agents_dir.join(folder_name);

    if !manager_dir.exists() {
        return Ok(()); // No manager directory yet — nothing to refresh
    }

    let filenames = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"];

    for filename in &filenames {
        let file_path = manager_dir.join(filename);

        let current_content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(_) => continue, // File doesn't exist — skip
        };

        let target = match target_default(filename, locale) {
            Some(t) => t,
            None => continue,
        };

        let normalized_current = normalize_content(&current_content);
        let normalized_target = normalize_content(target);

        // Already matches target locale — skip
        if normalized_current == normalized_target {
            continue;
        }

        // Check if current content matches ANY known bundled default
        let known_defaults = all_known_defaults(filename);
        let matches_any_default = known_defaults.iter().any(|default| {
            normalize_content(default) == normalized_current
        });

        if matches_any_default {
            // Unmodified default → replace with target locale's version
            std::fs::write(&file_path, target)
                .map_err(|e| format!("Failed to refresh {}: {}", filename, e))?;
        }
        // Otherwise: user has customised — leave untouched
    }

    Ok(())
}

/// Tauri command: refresh the default manager's persona files for the given locale.
/// Finds the default manager by `is_default` flag (works with both "매니저" and "manager" folders).
#[tauri::command]
pub fn refresh_default_manager_persona(
    app: AppHandle,
    db: State<'_, Database>,
    locale: String,
) -> Result<(), AppError> {
    let agents = agent_operations::list_agents_impl(&db)?;

    // Find default manager by is_default flag
    let default_agent = agents.iter().find(|a| a.is_default);

    // Fallback: check for legacy "매니저" folder
    let folder_name = match default_agent {
        Some(agent) => agent.folder_name.clone(),
        None => {
            match agents.iter().find(|a| a.folder_name == "매니저") {
                Some(agent) => agent.folder_name.clone(),
                None => return Ok(()), // No default manager found — nothing to refresh
            }
        }
    };

    refresh_default_persona_impl(&app, &folder_name, &locale)
        .map_err(|e| AppError::Io(format!("Failed to refresh manager persona: {}", e)))
}

/// Resize avatar image to 128x128 and return as Base64 string.
/// Input: Base64-encoded image data (without data URI prefix).
#[tauri::command]
pub fn resize_avatar(image_base64: String) -> Result<String, AppError> {
    use std::io::Cursor;

    // Decode base64
    let image_bytes = base64_decode(&image_base64).map_err(AppError::Validation)?;

    // Load image
    let img = image::load_from_memory(&image_bytes)
        .map_err(|e| AppError::Validation(format!("Failed to load image: {}", e)))?;

    // Resize to 128x128
    let resized = img.resize_exact(128, 128, image::imageops::FilterType::Lanczos3);

    // Encode as PNG to base64
    let mut buf = Cursor::new(Vec::new());
    resized
        .write_to(&mut buf, image::ImageFormat::Png)
        .map_err(|e| AppError::Io(format!("Failed to encode image: {}", e)))?;

    let encoded = base64_encode(&buf.into_inner());
    Ok(encoded)
}

/// Return the bootstrap prompt content (bundled at compile time).
/// The `locale` parameter ("ko" or "en") determines which version to return.
#[tauri::command]
pub fn get_bootstrap_prompt(locale: String) -> String {
    match locale.as_str() {
        "en" => include_str!("../../resources/en/bootstrap.md").to_string(),
        _ => include_str!("../../resources/ko/bootstrap.md").to_string(),
    }
}

fn get_agents_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(app_dir.join("agents"))
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    // Simple base64 decode using a lookup table
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(input)
        .map_err(|e| format!("Base64 decode error: {}", e))
}

fn base64_encode(input: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(input)
}

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Tests for normalize_content
    // -----------------------------------------------------------------------

    #[test]
    fn normalize_content_collapses_crlf() {
        assert_eq!(normalize_content("a\r\nb\r\nc"), "a\nb\nc");
    }

    #[test]
    fn normalize_content_trims_trailing_whitespace() {
        assert_eq!(normalize_content("hello   \nworld  \n"), "hello\nworld");
    }

    // -----------------------------------------------------------------------
    // Tests for locale-aware refresh logic (file-level, no AppHandle)
    // -----------------------------------------------------------------------

    /// Helper: simulate per-file locale-aware refresh logic without needing AppHandle.
    /// Returns Some(target_content) if the file should be updated, None otherwise.
    fn should_refresh(current: &str, filename: &str, locale: &str) -> Option<&'static str> {
        let target = target_default(filename, locale)?;
        let normalized_current = normalize_content(current);
        let normalized_target = normalize_content(target);

        if normalized_current == normalized_target {
            return None; // Already matches target
        }

        let known = all_known_defaults(filename);
        let matches_any = known.iter().any(|d| normalize_content(d) == normalized_current);

        if matches_any { Some(target) } else { None }
    }

    #[test]
    fn refresh_upgrades_old_v1_to_ko() {
        let result = should_refresh(OLD_IDENTITY_MD, "IDENTITY.md", "ko");
        assert!(result.is_some(), "Old v1 default should be upgraded to ko");
        assert_eq!(result.unwrap(), KO_IDENTITY_MD);
    }

    #[test]
    fn refresh_upgrades_old_v1_to_en() {
        let result = should_refresh(OLD_IDENTITY_MD, "IDENTITY.md", "en");
        assert!(result.is_some(), "Old v1 default should be upgraded to en");
        assert_eq!(result.unwrap(), EN_IDENTITY_MD);
    }

    #[test]
    fn refresh_switches_ko_to_en() {
        let result = should_refresh(KO_SOUL_MD, "SOUL.md", "en");
        assert!(result.is_some(), "ko default should switch to en");
        assert_eq!(result.unwrap(), EN_SOUL_MD);
    }

    #[test]
    fn refresh_switches_en_to_ko() {
        let result = should_refresh(EN_AGENTS_MD, "AGENTS.md", "ko");
        assert!(result.is_some(), "en default should switch to ko");
        assert_eq!(result.unwrap(), KO_AGENTS_MD);
    }

    #[test]
    fn refresh_preserves_user_modified_file() {
        let user_content = "# My Custom Agent\n\nI changed this file.\n";
        let result = should_refresh(user_content, "IDENTITY.md", "ko");
        assert!(result.is_none(), "User-modified file should be preserved");
    }

    #[test]
    fn refresh_idempotent_when_already_target() {
        let result = should_refresh(KO_IDENTITY_MD, "IDENTITY.md", "ko");
        assert!(result.is_none(), "Already at target locale should be left alone");
    }

    #[test]
    fn refresh_handles_user_md() {
        // USER.md: ko default → should switch to en
        let result = should_refresh(KO_USER_MD, "USER.md", "en");
        assert!(result.is_some(), "ko USER.md should switch to en");
        assert_eq!(result.unwrap(), EN_USER_MD);
    }

    #[test]
    fn refresh_preserves_custom_user_md() {
        let custom = "# My Profile\nName: Alice\n";
        let result = should_refresh(custom, "USER.md", "en");
        assert!(result.is_none(), "Custom USER.md should be preserved");
    }

    #[test]
    fn refresh_handles_crlf_old_default() {
        let crlf_old = OLD_IDENTITY_MD.replace('\n', "\r\n");
        let result = should_refresh(&crlf_old, "IDENTITY.md", "en");
        assert!(result.is_some(), "CRLF variant of old default should be refreshed");
    }

    #[test]
    fn refresh_handles_trailing_whitespace() {
        let with_spaces = OLD_IDENTITY_MD
            .lines()
            .map(|l| format!("{}   ", l))
            .collect::<Vec<_>>()
            .join("\n");
        let result = should_refresh(&with_spaces, "IDENTITY.md", "ko");
        assert!(result.is_some(), "Trailing whitespace variant should be refreshed");
    }

    // -----------------------------------------------------------------------
    // Integration tests using temp directory (no AppHandle)
    // -----------------------------------------------------------------------

    /// Helper: simulate full refresh_default_persona_impl for a temp directory
    fn simulate_refresh(dir: &std::path::Path, locale: &str) {
        let filenames = ["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md"];
        for filename in &filenames {
            let file_path = dir.join(filename);
            let current = match std::fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue,
            };
            if let Some(target) = should_refresh(&current, filename, locale) {
                std::fs::write(&file_path, target).unwrap();
            }
        }
    }

    #[test]
    fn refresh_integration_old_v1_to_ko() {
        let tmp = std::env::temp_dir().join(format!("wa_test_v1_ko_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        std::fs::write(tmp.join("IDENTITY.md"), OLD_IDENTITY_MD).unwrap();
        std::fs::write(tmp.join("SOUL.md"), OLD_SOUL_MD).unwrap();
        std::fs::write(tmp.join("AGENTS.md"), OLD_AGENTS_MD).unwrap();
        std::fs::write(tmp.join("USER.md"), "custom user notes").unwrap();

        simulate_refresh(&tmp, "ko");

        assert_eq!(std::fs::read_to_string(tmp.join("IDENTITY.md")).unwrap(), KO_IDENTITY_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("SOUL.md")).unwrap(), KO_SOUL_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("AGENTS.md")).unwrap(), KO_AGENTS_MD);
        // Custom USER.md preserved
        assert_eq!(std::fs::read_to_string(tmp.join("USER.md")).unwrap(), "custom user notes");

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn refresh_integration_ko_to_en_locale_switch() {
        let tmp = std::env::temp_dir().join(format!("wa_test_ko_en_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // Start with ko defaults
        std::fs::write(tmp.join("IDENTITY.md"), KO_IDENTITY_MD).unwrap();
        std::fs::write(tmp.join("SOUL.md"), KO_SOUL_MD).unwrap();
        std::fs::write(tmp.join("AGENTS.md"), KO_AGENTS_MD).unwrap();
        std::fs::write(tmp.join("USER.md"), KO_USER_MD).unwrap();

        // Switch to en
        simulate_refresh(&tmp, "en");

        assert_eq!(std::fs::read_to_string(tmp.join("IDENTITY.md")).unwrap(), EN_IDENTITY_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("SOUL.md")).unwrap(), EN_SOUL_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("AGENTS.md")).unwrap(), EN_AGENTS_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("USER.md")).unwrap(), EN_USER_MD);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn refresh_integration_preserves_custom_and_idempotent() {
        let tmp = std::env::temp_dir().join(format!("wa_test_preserve_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        let custom_identity = "# Custom Identity\nMy own content.\n";
        std::fs::write(tmp.join("IDENTITY.md"), custom_identity).unwrap();
        std::fs::write(tmp.join("SOUL.md"), KO_SOUL_MD).unwrap();
        std::fs::write(tmp.join("AGENTS.md"), OLD_AGENTS_MD).unwrap();
        std::fs::write(tmp.join("USER.md"), KO_USER_MD).unwrap();

        simulate_refresh(&tmp, "en");

        // Custom preserved
        assert_eq!(std::fs::read_to_string(tmp.join("IDENTITY.md")).unwrap(), custom_identity);
        // Defaults switched to en
        assert_eq!(std::fs::read_to_string(tmp.join("SOUL.md")).unwrap(), EN_SOUL_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("AGENTS.md")).unwrap(), EN_AGENTS_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("USER.md")).unwrap(), EN_USER_MD);

        // Run again — idempotent
        simulate_refresh(&tmp, "en");

        assert_eq!(std::fs::read_to_string(tmp.join("IDENTITY.md")).unwrap(), custom_identity);
        assert_eq!(std::fs::read_to_string(tmp.join("SOUL.md")).unwrap(), EN_SOUL_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("AGENTS.md")).unwrap(), EN_AGENTS_MD);
        assert_eq!(std::fs::read_to_string(tmp.join("USER.md")).unwrap(), EN_USER_MD);

        let _ = std::fs::remove_dir_all(&tmp);
    }

    // -----------------------------------------------------------------------
    // Original validation tests
    // -----------------------------------------------------------------------

    #[test]
    fn validate_accepts_identity_md() {
        assert!(validate_agent_file_inputs("my-agent", "IDENTITY.md").is_ok());
    }

    #[test]
    fn validate_accepts_all_allowed_file_names() {
        for name in &["IDENTITY.md", "SOUL.md", "USER.md", "AGENTS.md", "TOOL_CONFIG.json"] {
            assert!(
                validate_agent_file_inputs("my-agent", name).is_ok(),
                "expected Ok for {name}"
            );
        }
    }

    #[test]
    fn validate_rejects_invalid_file_name() {
        let result = validate_agent_file_inputs("my-agent", "hack.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid file name"));
    }

    #[test]
    fn validate_rejects_empty_file_name() {
        let result = validate_agent_file_inputs("my-agent", "");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid file name"));
    }

    #[test]
    fn validate_rejects_folder_with_forward_slash() {
        let result = validate_agent_file_inputs("../../etc", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_rejects_folder_with_backslash() {
        let result = validate_agent_file_inputs("..\\etc", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_rejects_folder_with_double_dots() {
        let result = validate_agent_file_inputs("..", "IDENTITY.md");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid folder name"));
    }

    #[test]
    fn validate_accepts_valid_folder_name() {
        assert!(validate_agent_file_inputs("my-agent", "IDENTITY.md").is_ok());
    }
}
