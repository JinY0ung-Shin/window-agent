# TODO: 에이전트 페르소나 시스템 개선

## 현재 문제
- 에이전트들이 자기 이름도 모름 (system_prompt가 제대로 전달 안 되거나 너무 약함)
- 프롬프트가 너무 간결해서 페르소나 유지가 안 됨

## OpenClaw 페르소나 아키텍처 조사 결과

### 핵심 개념: Soul vs Identity 분리
- **Soul (SOUL.md)**: 내부 행동 철학. "넌 챗봇이 아니다. 누군가가 되어가는 중이다."
  - 의사결정/응답 방식을 가이드하는 매니페스토
  - 구체적 행동을 지시하지 않고 철학적 방향 제시
- **Identity (IDENTITY.md)**: 외부 표현 (이름, 이모지, 바이브, 아바타)
  - Soul이 내면이면, Identity는 사용자가 보는 겉모습
  - "격식있는 soul + 장난스러운 닉네임/이모지" 같은 조합 가능

### 파일 구조 (에이전트당)
```
~/.openclaw/agents/<agentId>/
  SOUL.md        # 행동 철학, 성격 매니페스토
  IDENTITY.md    # 이름, 이모지, 아바타, 바이브
  AGENTS.md      # 지시사항, 역할 정의
  USER.md        # 사용자 컨텍스트 (선택)
  MEMORY.md      # 장기 기억 (큐레이션된 정보)
  daily logs     # 일일 대화 컨텍스트 로그
```

### 페르소나 유지 메커니즘
1. **세션 부트스트랩**: 시작 시 워크스페이스 파일 8개를 system prompt에 로드 (최대 20,000자)
2. **프롬프트 컴파일러**: "이 페르소나와 톤을 체화하라. 딱딱하고 일반적인 답변 피하라" 명시적 지시
3. **Identity 해석 우선순위**: 글로벌 설정 < 에이전트별 설정 < 워크스페이스 파일 < 기본값
4. **완전 격리**: 에이전트별 워크스페이스, 세션 스토어, 대화 히스토리 분리

### 메모리 시스템
- 하이브리드 검색: 벡터 임베딩(70%) + BM25 키워드(30%)
- 컨텍스트 오버플로 전에 중요 정보 플러시
- MEMORY.md = 큐레이션된 장기 기억
- 일일 .md 로그 = 실행 컨텍스트

## 우리 프로젝트에 적용할 방안 (구현 계획)

### Phase 1: 즉시 개선 (시스템 프롬프트 강화)
- [ ] system_prompt에 에이전트 이름/역할 더 강하게 주입
- [ ] "당신의 이름은 X입니다. 절대 다른 이름을 사용하지 마세요" 식으로 명시
- [ ] 각 에이전트별 전문 지식 범위, 대화 예시 추가

### Phase 2: Soul/Identity 파일 시스템 도입
- [ ] 에이전트별 워크스페이스 디렉토리 구조 생성
  - `data/agents/<agent-id>/soul.md` - 행동 철학
  - `data/agents/<agent-id>/identity.md` - 외부 표현
  - `data/agents/<agent-id>/instructions.md` - 상세 지시사항
  - `data/agents/<agent-id>/memory.md` - 장기 기억
- [ ] AgentRunner가 파일에서 프롬프트 조합하여 로드
- [ ] DB의 system_prompt 대신 파일 기반으로 전환 (또는 병행)

### Phase 3: 메모리 + 컨텍스트 관리
- [ ] 에이전트별 대화 요약/기억 저장
- [ ] 세션 시작 시 관련 기억 로드
- [ ] 프롬프트 컴파일러: 여러 파일을 우선순위에 따라 조합

## 참고 자료
- OpenClaw Multi-Agent Docs: https://docs.openclaw.ai/concepts/multi-agent
- OpenClaw Identity Architecture: https://www.mmntm.net/articles/openclaw-identity-architecture
- OpenClaw GitHub: https://github.com/openclaw/openclaw
