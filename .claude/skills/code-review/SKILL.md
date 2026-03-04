---
name: code-review
description: Get code review from Gemini CLI + Codex CLI
user_invocable: true
---

# Code Review via Gemini + Codex

Run Gemini CLI and Codex CLI **in parallel** to get code reviews on current changes.

## Steps

1. Check current changes with `git diff HEAD`. If no changes, use the latest commit (`git diff HEAD~1`).
   - Use `git diff --quiet HEAD` exit code to determine if there are changes.
   - If changes exist: `mode=uncommitted`, otherwise: `mode=commit`

2. **Run Gemini and Codex in parallel.** Make both Bash calls simultaneously.

### Gemini CLI Review

Instruct Gemini to run `git diff` itself via prompt. This leverages Gemini's own tool use instead of stdin piping, handling large diffs without issues.

If uncommitted changes exist:
```bash
cd /c/Users/gojam/window-agent && gemini --yolo -o text -p "You are a senior full-stack developer and code reviewer. This project is a Tauri 2 (Rust) + React 19 (TypeScript) desktop AI chat app.

Run \`git diff HEAD\` to check the current uncommitted changes and perform a code review.

## Review Criteria
1. **Bugs / Logic Errors** — incorrect logic, missing error handling, edge cases
2. **Security** — API key exposure, injection, unsafe patterns
3. **Performance** — unnecessary computation, N+1 problems, potential memory leaks
4. **Code Quality** — duplicate code, naming, type safety, separation of concerns
5. **Improvements / Suggestions** — better approaches or patterns

## Output Format
Organize findings by each criterion. Omit sections with no findings.
Mark severity: 🔴 Critical, 🟡 Warning, 💡 Suggestion
Include specific file names and line references."
```

If no uncommitted changes (review latest commit):
```bash
cd /c/Users/gojam/window-agent && gemini --yolo -o text -p "You are a senior full-stack developer and code reviewer. This project is a Tauri 2 (Rust) + React 19 (TypeScript) desktop AI chat app.

Run \`git diff HEAD~1\` to check the latest commit changes and perform a code review.

## Review Criteria
1. **Bugs / Logic Errors** — incorrect logic, missing error handling, edge cases
2. **Security** — API key exposure, injection, unsafe patterns
3. **Performance** — unnecessary computation, N+1 problems, potential memory leaks
4. **Code Quality** — duplicate code, naming, type safety, separation of concerns
5. **Improvements / Suggestions** — better approaches or patterns

## Output Format
Organize findings by each criterion. Omit sections with no findings.
Mark severity: 🔴 Critical, 🟡 Warning, 💡 Suggestion
Include specific file names and line references."
```

### Codex CLI Review

**Note: `--uncommitted`/`--commit` and `[PROMPT]` cannot be used together.**

If uncommitted changes exist:
```bash
cd /c/Users/gojam/window-agent && codex review --uncommitted
```

If no uncommitted changes (review latest commit):
```bash
cd /c/Users/gojam/window-agent && codex review --commit HEAD
```

3. Present both review results to the user under separate **"Gemini Review"** and **"Codex Review"** sections.

4. Highlight issues flagged by both reviewers as high-priority.

5. **Act proactively — fix issues directly.** Don't just passively relay reviews. Follow these guidelines:

### Fix immediately (no confirmation needed)
- 🔴 Critical issues: bugs, security vulnerabilities, potential data loss
- Obvious mistakes: typos, missing imports, wrong types

### Fix and report
- 🟡 Warning issues: performance problems, missing error handling, type safety
- Code quality: duplicate code, separation of concerns violations

### Ask user for decision
- 💡 Suggestions involving large structural changes: architecture changes, new patterns
- Conflicting opinions: cases where Gemini and Codex suggest opposite approaches

### Ignore
- False positives: verified by reading the code that it's not actually an issue
- Out of scope: issues in existing code unrelated to current changes
- Style preferences: suggestions with no practical benefit beyond taste

6. After applying fixes, run tests to verify no regressions.
