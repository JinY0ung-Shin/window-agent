#!/bin/bash
set -e

FAIL=0

echo "=== 1. Build & test ==="
npm run build
npm test

echo "=== 2. Remaining hardcoded hex colors ==="
# Whitelist: intentionally excluded hex values (see PLAN.md Scope Exclusions)
# #c7d2fe (primary gradient), #fff (keyword-like shorthand), #fafafa, #f5f3ff,
# #d7deea, #f3f4f6, #d4ddff, #e7d4d7, #f7f7fb (tool-run one-off colors)
WHITELIST='#(fff|c7d2fe|fafafa|f5f3ff|d7deea|f3f4f6|d4ddff|e7d4d7|f7f7fb)\b'

HITS=$(grep -rnE '#[0-9a-fA-F]{3,8}\b' src/styles/*.css \
  | grep -vE 'hljs-github' \
  | grep -vE '^[^[:space:]]+:[[:digit:]]+:[[:space:]]*--[a-zA-Z0-9_-]+[[:space:]]*:' \
  | grep -vE "$WHITELIST" \
  || true)

if [ -n "$HITS" ]; then
  echo "$HITS"
  echo "FAIL: Unexpected hardcoded hex colors found"
  FAIL=1
else
  echo "PASS: No unexpected hardcoded hex colors"
fi

echo "=== 3. No residual libp2p imports ==="
LIBP2P_HITS=$(grep -rnE 'use libp2p|libp2p_identity|libp2p::' src-tauri/src/ || true)
if [ -z "$LIBP2P_HITS" ]; then
  echo "PASS: No libp2p imports in source"
else
  echo "$LIBP2P_HITS"
  echo "FAIL: Residual libp2p imports found"
  FAIL=1
fi

echo "=== 4. Undefined CSS variables (used - defined) ==="
DEFINED=$(grep -ohE '\-\-[a-zA-Z0-9_-]+[[:space:]]*:' src/styles/*.css | sed 's/[[:space:]]*://' | sort -u)
USED=$(grep -ohE 'var\(\-\-[a-zA-Z0-9_-]+' src/styles/*.css | sed 's/var(//' | sort -u)
UNDEF=$(comm -23 <(echo "$USED") <(echo "$DEFINED"))
if [ -z "$UNDEF" ]; then
  echo "PASS: All variables defined"
else
  echo "$UNDEF"
  echo "FAIL: Undefined CSS variables found"
  FAIL=1
fi

exit $FAIL
