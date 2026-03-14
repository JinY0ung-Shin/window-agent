# Window Agent — Development Guide

## Development Process

Follow this process when implementing feature requests.

### 1. Plan + Review Loop
1. Analyze requirements and draft an implementation plan
2. Request a plan review from Codex (`/ask codex [PLAN REVIEW REQUEST]`)
3. Iterate — fix issues and re-request review until score is **>= 8.0** with **0 critical issues**
4. Up to 3 rounds max; if still failing, report to the user

### 2. Parallel Implementation
1. Create a team via TeamCreate and run parallelizable work in parallel
2. Each agent works in an isolated worktree environment
3. Merge all worktrees and run integration tests after completion

### 3. Code Review Loop
1. Request a code review from Codex (`/ask codex [CODE REVIEW REQUEST]`)
2. Iterate — fix issues and re-request review until score is **>= 8.0** with **0 critical issues**
3. All tests must pass

### 4. Commit
1. Commit only after review passes
2. Include review score and test results in the commit message
