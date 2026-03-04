---
name: gemini-advisor
description: Discuss implementation plans with Gemini CLI
user_invocable: true
---

# Gemini Advisor — Implementation Planning

Use Gemini CLI to discuss implementation plans for specific features or tasks.
When the user has questions about implementation direction, pass the codebase context to Gemini for collaborative strategy discussion.

## Usage Examples

- `/gemini-advisor How should we implement the agent persona system?`
- `/gemini-advisor Is this DB schema design okay?`
- `/gemini-advisor Which is better for this feature: approach A vs B?`

## Steps

1. Identify the user's implementation question or concern. If unclear, ask for clarification.

2. Select relevant source files based on the question.
   - Related components, stores, services, Rust code, etc.
   - Include plan files from memory if they exist (e.g., `phase1-plan.md`, `agent-persona-plan.md`)

3. Run Gemini CLI with the following format. Replace `{relevant_files}` and `{user_question}` accordingly:

```bash
cd /c/Users/gojam/window-agent && {
  # Project structure overview
  echo "=== Project Structure ==="
  find src src-tauri/src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.rs" \) | head -50
  echo ""

  # Output relevant files with filenames
  for f in {relevant_files}; do
    echo "=== $f ==="
    cat "$f"
    echo ""
  done

  # Include memory plan files if they exist
  for f in /c/Users/gojam/.claude/projects/C--Users-gojam-window-agent/memory/*.md; do
    if [ -f "$f" ]; then
      echo "=== Memory: $(basename $f) ==="
      cat "$f"
      echo ""
    fi
  done
} | gemini -p "You are a senior software architect. The code and documents above are from a Tauri 2 (Rust) + React 19 (TypeScript) desktop AI chat app.

User question: {user_question}

Please discuss the implementation plan from the following perspectives:

## Discussion Points
1. **Implementation Strategy** — approach, step-by-step implementation order
2. **Architectural Fit** — consistency with existing codebase, pattern adherence
3. **Trade-offs** — pros and cons of each approach, complexity vs flexibility
4. **Concrete Proposals** — file structure, type definitions, DB schema, etc.
5. **Caveats** — potential issues, edge cases, migration considerations

## Output Format
- Lead with the key conclusion, then explain the reasoning
- If multiple options exist, organize them in a comparison table
- Include concrete code examples or schemas" -o text
```

4. Present Gemini's advice to the user.

5. Discuss further based on the advice:
   - Clearly distinguish which Gemini suggestions you agree with and where you have different opinions
   - Once the user decides, either save the plan to memory or start code implementation
