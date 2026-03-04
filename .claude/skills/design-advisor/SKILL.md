---
name: design-advisor
description: Get frontend design advice from Gemini CLI
user_invocable: true
---

# Design Advisor via Gemini

Use Gemini CLI to get expert advice on frontend design.
When the user has design-related questions or concerns, pass the relevant code to Gemini for professional design guidance.

## Usage Examples

- "I want to improve the sidebar design"
- "The color scheme doesn't look right"
- "I want to improve the chat input UX"
- "Give me an overall design assessment"

## Steps

1. Identify the user's design question or concern.

2. Select relevant frontend source files to pass to Gemini.
   - For overall assessments: all components + CSS
   - For specific component questions: only the relevant component + related CSS

   Relevant files:
   - `src/App.css` — global stylesheet
   - `src/App.tsx` — root component
   - `src/components/layout/MainLayout.tsx` — main layout
   - `src/components/layout/Sidebar.tsx` — sidebar
   - `src/components/chat/ChatWindow.tsx` — chat window
   - `src/components/chat/ChatMessage.tsx` — message bubble
   - `src/components/chat/ChatInput.tsx` — chat input
   - `src/components/settings/SettingsModal.tsx` — settings modal

3. Run Gemini CLI with the following format. Replace `{relevant_files}` and `{user_question}` accordingly:

```bash
cd /c/Users/gojam/window-agent && {
  # Output relevant files with filenames
  for f in {relevant_files}; do
    echo "=== $f ==="
    cat "$f"
    echo ""
  done
} | gemini -p "You are a senior frontend designer and UX expert. The code above is the frontend source of a Tauri 2 + React 19 desktop AI chat app.

User question: {user_question}

Please provide specific design advice for the question above.
- Analyze the problems and suggest improvement directions
- Include concrete CSS/component code modifications where possible" -o text
```

4. Present Gemini's advice to the user.

5. If any suggestions are worth applying, ask the user whether to proceed and then modify the code accordingly.
