#!/bin/bash
set -e

echo "=== 1. Build & test ==="
npm run build
npm test

echo "=== 2. Remaining hardcoded hex colors ==="
grep -rnE '#[0-9a-fA-F]{3,8}\b' src/styles/*.css \
  --include='*.css' \
  | grep -vE 'hljs-github' \
  | grep -vE '^[^[:space:]]+:[[:digit:]]+:[[:space:]]*--[a-zA-Z0-9_-]+[[:space:]]*:' \
  || echo "None found"

echo "=== 3. Undefined CSS variables (used - defined) ==="
DEFINED=$(grep -ohE '\-\-[a-zA-Z0-9_-]+[[:space:]]*:' src/styles/*.css | sed 's/[[:space:]]*://' | sort -u)
USED=$(grep -ohE 'var\(\-\-[a-zA-Z0-9_-]+' src/styles/*.css | sed 's/var(/-/' | sed 's/^-//' | sort -u)
UNDEF=$(comm -23 <(echo "$USED") <(echo "$DEFINED"))
if [ -z "$UNDEF" ]; then
  echo "All variables defined"
else
  echo "$UNDEF"
fi
