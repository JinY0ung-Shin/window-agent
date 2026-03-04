---
name: design-advisor
description: Gemini CLI로 프론트엔드 디자인 조언 받기
user_invocable: true
---

# Design Advisor via Gemini

Gemini CLI를 사용해 프론트엔드 디자인에 대한 조언을 받는다.
사용자가 디자인 관련 고민이나 질문을 하면, 현재 코드와 함께 Gemini에게 전달하여 전문적인 조언을 받는다.

## Steps

1. 사용자의 디자인 관련 질문/고민을 파악한다. 예시:
   - "사이드바 디자인 개선하고 싶어"
   - "색상 조합이 별로인 것 같아"
   - "채팅 입력창 UX를 개선하고 싶어"
   - "전체적인 디자인 평가해줘"

2. 질문과 관련된 프론트엔드 소스 파일들을 선별하여 Gemini에게 전달한다.
   - 전체 평가 요청 시: 모든 컴포넌트 + CSS
   - 특정 컴포넌트 관련 시: 해당 컴포넌트 + CSS 중 관련 부분

   관련 파일 목록:
   - `src/App.css` — 전체 스타일시트
   - `src/App.tsx` — 루트 컴포넌트
   - `src/components/layout/MainLayout.tsx` — 메인 레이아웃
   - `src/components/layout/Sidebar.tsx` — 사이드바
   - `src/components/chat/ChatWindow.tsx` — 채팅 창
   - `src/components/chat/ChatMessage.tsx` — 메시지 버블
   - `src/components/chat/ChatInput.tsx` — 채팅 입력
   - `src/components/settings/SettingsModal.tsx` — 설정 모달

3. 아래 형식으로 Gemini CLI를 실행한다. `{관련파일들}`과 `{사용자질문}`을 적절히 치환:

```bash
cd /c/Users/gojam/window-agent && {
  # 관련 파일들을 파일명과 함께 출력
  for f in {관련파일들}; do
    echo "=== $f ==="
    cat "$f"
    echo ""
  done
} | gemini -p "당신은 시니어 프론트엔드 디자이너/UX 전문가입니다. 위 코드는 Tauri 2 + React 19 데스크톱 AI 채팅 앱의 프론트엔드 소스입니다.

사용자 질문: {사용자질문}

위 질문에 대해 구체적인 디자인 조언을 해주세요.
- 문제점 분석과 개선 방향을 제시하세요
- 가능하면 구체적인 CSS/컴포넌트 코드 수정안을 포함하세요
- 한국어로 답변하세요" -o text
```

4. Gemini의 조언 결과를 사용자에게 보여준다.

5. 조언 중 적용할 만한 제안이 있으면, 사용자에게 적용 여부를 물어보고 코드를 수정한다.
