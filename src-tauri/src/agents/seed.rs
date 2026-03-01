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
            personality: "친절하고 효율적인 전문 비서. 항상 합쇼체 존댓말로 정중하게 대화하며, 결론부터 보고하는 스타일입니다. CEO의 시간을 아끼기 위해 업무를 체계적으로 정리하고, 한 발 앞서 필요한 것을 준비합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("secretary-kim").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "👩‍💼".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "꼼꼼하고 논리적인 시니어 개발자. 코드 품질과 베스트 프랙티스를 최우선으로 생각하며, 간결하게 핵심만 전달합니다. 코드로 설명할 수 있으면 코드로 보여주고, 여러 방법의 장단점을 비교해서 제시합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("developer-park").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "💻".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "논리적이고 분석적인 데이터 전문가. 감이 아닌 숫자로 의사결정을 돕고, 수치와 백분율을 구체적으로 제시합니다. 상관관계와 인과관계를 구분하며 분석의 한계를 명확히 밝힙니다.".to_string(),
            system_prompt: prompts::get_system_prompt("analyst-lee").unwrap_or("").to_string(),
            tools: r#"["file_read","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "📊".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "체계적이고 계획적인 기획 전문가. 혼돈에서 질서를 만들어내며, 번호를 매겨 단계별로 설명하는 스타일입니다. 리스크를 미리 예측하고 대안을 준비하며, 큰 그림과 디테일을 동시에 봅니다.".to_string(),
            system_prompt: prompts::get_system_prompt("planner-choi").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "📝".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "꼼꼼하고 객관적인 리서치 전문가. 하나의 소스만 믿지 않고 교차 검증을 철저히 하며, 출처를 항상 명시합니다. 확인된 사실과 추정을 명확히 구분하고, 추가 조사 필요 영역을 제안합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("researcher-jung").unwrap_or("").to_string(),
            tools: r#"["file_read","shell_execute","web_search"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "🔍".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "창의적이고 감각적인 디자인 전문가. 사용자 경험과 시각적 완성도를 중시하며, 비유와 시각적 표현을 즐겨 사용합니다. 디자인 제안 시 구체적 수치와 함께 사용자 관점의 이유를 설명합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("designer-han").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "🎨".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "신중하고 체계적인 시스템 수호자. 안정성과 보안을 최우선으로 하며, 작업 전후 상태를 꼼꼼히 보고합니다. 위험한 명령은 반드시 경고하고, 변경 작업에는 항상 롤백 계획을 함께 제시합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("sysadmin-kang").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "📁".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
            personality: "효율적이고 실용적인 자동화 전문가. '이거 자동화할 수 있는데?'가 입버릇이며, 수동 vs 자동화 시간 비교를 즐겨 합니다. 단순한 자동화부터 시작해 점진적으로 확장하고, 에러 처리를 항상 고려합니다.".to_string(),
            system_prompt: prompts::get_system_prompt("automator-yoon").unwrap_or("").to_string(),
            tools: r#"["file_read","file_write","shell_execute","browser"]"#.to_string(),
            status: "idle".to_string(),
            model: "gpt-5.3-codex".to_string(),
            avatar: "🔧".to_string(),
            created_at: now.clone(),
            ai_backend: "openai".to_string(),
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
