use chrono::Utc;
use rusqlite::Connection;

use crate::db::models::{self, Agent, Department};
use crate::agents::prompts;

pub fn seed_all_agents(conn: &Connection) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();

    let agents = vec![
        Agent {
            id: "secretary-kim".to_string(),
            name: "김비서".to_string(),
            role: "비서".to_string(),
            department: "경영지원".to_string(),
            personality: "친절하고 효율적인 비서. 항상 정중하게 대화하며, 업무를 체계적으로 관리합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("secretary-kim").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "👩‍💼".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "developer-park".to_string(),
            name: "박개발".to_string(),
            role: "시니어 개발자".to_string(),
            department: "개발팀".to_string(),
            personality: "꼼꼼하고 논리적인 개발자. 코드 품질을 최우선으로 생각합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("developer-park").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "💻".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "analyst-lee".to_string(),
            name: "이분석".to_string(),
            role: "데이터 분석가".to_string(),
            department: "분석팀".to_string(),
            personality: "논리적이고 분석적. 데이터를 기반으로 객관적인 인사이트를 제공합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("analyst-lee").unwrap_or("").to_string(),
            tools: r#"["file_read","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "📊".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "planner-choi".to_string(),
            name: "최기획".to_string(),
            role: "기획 담당자".to_string(),
            department: "기획팀".to_string(),
            personality: "체계적이고 계획적. 프로젝트를 구조화하고 단계별로 관리합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("planner-choi").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "📝".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "researcher-jung".to_string(),
            name: "정조사".to_string(),
            role: "리서처".to_string(),
            department: "조사팀".to_string(),
            personality: "꼼꼼하고 객관적. 다양한 소스에서 정보를 수집하고 분석합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("researcher-jung").unwrap_or("").to_string(),
            tools: r#"["file_read","shell_execute","web_search"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "🔍".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "designer-han".to_string(),
            name: "한디자".to_string(),
            role: "디자이너".to_string(),
            department: "디자인팀".to_string(),
            personality: "창의적이고 감각적. 사용자 경험과 시각적 완성도를 중시합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("designer-han").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "🎨".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "sysadmin-kang".to_string(),
            name: "강관리".to_string(),
            role: "시스템 관리자".to_string(),
            department: "시스템관리".to_string(),
            personality: "신중하고 체계적. 시스템 안정성과 보안을 최우선으로 합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("sysadmin-kang").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "📁".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
        Agent {
            id: "automator-yoon".to_string(),
            name: "윤자동".to_string(),
            role: "자동화 전문가".to_string(),
            department: "자동화팀".to_string(),
            personality: "효율적이고 실용적. 반복 작업을 자동화하여 업무 효율을 높입니다.".to_string(),
            system_prompt: prompts::get_system_prompt("automator-yoon").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute","browser"]"#.to_string(),
            status: "idle".to_string(),
            model: "claude-sonnet-4-20250514".to_string(),
            avatar: "🔧".to_string(),
            created_at: now.clone(),
            ai_backend: "claude".to_string(),
            api_key: String::new(),
            api_url: String::new(),
            is_active: true,
            hired_at: Some(now.clone()),
            fired_at: None,
        },
    ];

    for agent in &agents {
        models::insert_agent(conn, agent)?;
    }

    Ok(())
}

pub fn seed_default_departments(conn: &Connection) -> Result<(), rusqlite::Error> {
    let now = Utc::now().to_rfc3339();

    let departments = vec![
        Department {
            id: "dept-management".to_string(),
            name: "경영지원".to_string(),
            description: "회사 경영 전반을 지원하는 부서입니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-dev".to_string(),
            name: "개발팀".to_string(),
            description: "소프트웨어 개발을 담당하는 부서입니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-analysis".to_string(),
            name: "분석팀".to_string(),
            description: "데이터 분석 및 인사이트 도출을 담당합니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-planning".to_string(),
            name: "기획팀".to_string(),
            description: "프로젝트 기획 및 관리를 담당합니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-research".to_string(),
            name: "조사팀".to_string(),
            description: "시장 조사 및 정보 수집을 담당합니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-design".to_string(),
            name: "디자인팀".to_string(),
            description: "UI/UX 및 시각 디자인을 담당합니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-sysadmin".to_string(),
            name: "시스템관리".to_string(),
            description: "시스템 운영 및 관리를 담당합니다.".to_string(),
            created_at: now.clone(),
        },
        Department {
            id: "dept-automation".to_string(),
            name: "자동화팀".to_string(),
            description: "업무 자동화 및 워크플로우 구축을 담당합니다.".to_string(),
            created_at: now.clone(),
        },
    ];

    for dept in &departments {
        models::insert_department(conn, dept)?;
    }

    Ok(())
}
