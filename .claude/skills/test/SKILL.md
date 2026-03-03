---
name: test
description: Run all tests (Rust backend + Frontend)
user_invocable: true
---

# Run Tests

Run the full test suite for both Rust backend and React frontend.

## Steps

1. Run Rust backend tests:
```bash
cd src-tauri && cargo test
```

2. Run frontend tests:
```bash
npm test
```

3. Report the results summary showing pass/fail counts for each.

If any tests fail, analyze the failure output and suggest fixes.
