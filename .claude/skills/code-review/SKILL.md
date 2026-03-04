---
name: code-review
description: Gemini CLI + Codex CLI로 코드 리뷰 받기
user_invocable: true
---

# Code Review via Gemini + Codex

Gemini CLI와 Codex CLI를 **동시에** 사용해 현재 변경사항에 대한 코드 리뷰를 받는다.

## Steps

1. `git diff HEAD`로 현재 변경사항을 확인한다. 변경사항이 없으면 최근 커밋(`git diff HEAD~1`)을 사용한다.

2. **Gemini와 Codex를 병렬로 실행한다.** 두 명령을 동시에 Bash 호출하여 병렬 처리한다.

### Gemini CLI 리뷰

```bash
cd /c/Users/gojam/window-agent && {
  diff_output=$(git diff HEAD)
  if [ -z "$diff_output" ]; then
    diff_output=$(git diff HEAD~1)
    echo "# 최근 커밋의 변경사항 리뷰"
  else
    echo "# 스테이징 전 변경사항 리뷰"
  fi
  echo "$diff_output"
} | gemini -p "당신은 시니어 풀스택 개발자이자 코드 리뷰어입니다. 위 diff는 Tauri 2 (Rust) + React 19 (TypeScript) 데스크톱 AI 채팅 앱의 변경사항입니다.

아래 관점에서 코드 리뷰를 해주세요:

## 리뷰 관점
1. **버그/논리 오류** — 잘못된 로직, 누락된 에러 처리, edge case
2. **보안** — API 키 노출, 인젝션, 안전하지 않은 패턴
3. **성능** — 불필요한 연산, N+1 문제, 메모리 누수 가능성
4. **코드 품질** — 중복 코드, 네이밍, 타입 안전성, 관심사 분리
5. **개선/제안 사항** — 더 나은 접근법이나 패턴 제안

## 출력 형식
각 관점별로 발견사항을 정리하고, 발견이 없으면 해당 섹션을 생략하세요.
심각도를 표시하세요: 🔴 Critical, 🟡 Warning, 💡 Suggestion
구체적인 파일명과 라인 참조를 포함하세요.
한국어로 답변하세요." -o text
```

### Codex CLI 리뷰

변경사항이 있으면 (uncommitted):
```bash
cd /c/Users/gojam/window-agent && codex review --uncommitted "이 프로젝트는 Tauri 2 (Rust) + React 19 (TypeScript) 데스크톱 AI 채팅 앱입니다. 버그, 보안, 성능, 코드 품질 관점에서 리뷰해주세요. 한국어로 답변하세요."
```

변경사항이 없으면 최근 커밋 리뷰:
```bash
cd /c/Users/gojam/window-agent && codex review --commit HEAD "이 프로젝트는 Tauri 2 (Rust) + React 19 (TypeScript) 데스크톱 AI 채팅 앱입니다. 버그, 보안, 성능, 코드 품질 관점에서 리뷰해주세요. 한국어로 답변하세요."
```

3. 두 리뷰 결과를 각각 **"Gemini 리뷰"**, **"Codex 리뷰"** 섹션으로 나누어 사용자에게 보여준다.

4. 두 리뷰어가 공통으로 지적한 이슈가 있으면 우선적으로 강조한다.

5. **능동적으로 판단하고 직접 수정한다.** 리뷰 결과를 수동적으로 전달만 하지 말고, 아래 기준에 따라 직접 행동한다:

### 즉시 수정 (확인 없이)
- 🔴 Critical 이슈: 버그, 보안 취약점, 데이터 손실 가능성
- 명백한 실수: 오타, 누락된 import, 잘못된 타입

### 수정 후 보고
- 🟡 Warning 이슈: 성능 문제, 에러 처리 누락, 타입 안전성
- 코드 품질: 중복 코드, 관심사 분리 위반

### 사용자에게 판단 요청
- 💡 Suggestion 중 구조 변경이 큰 것: 아키텍처 변경, 새 패턴 도입
- 의견이 갈리는 것: Gemini와 Codex가 상반된 제안을 한 경우

### 무시
- 오탐 (false positive): 코드를 직접 확인하여 실제 문제가 아닌 것
- 범위 밖: 현재 변경과 관련 없는 기존 코드에 대한 지적
- 취향 차이: 스타일만 다르고 실질적 이점이 없는 제안

6. 수정을 적용한 후 테스트를 실행하여 회귀가 없는지 확인한다.
