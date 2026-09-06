#!/usr/bin/env bash
set -euo pipefail
base="${API_URL:-http://localhost:4000/api}"
curl -fsS "$base/health" >/dev/null
curl -fsS -X POST "$base/sync" >/dev/null
curl -fsS -X POST "$base/decisions/d-m1/undo" >/dev/null
curl -fsS -X POST -H 'Content-Type: application/json' -d '{"label":"routine"}' "$base/decisions/d-m2/correction" >/dev/null
curl -fsS -X POST "$base/decisions/d-m2/approve-draft" >/dev/null
curl -fsS "$base/activity" >/dev/null
echo "InboxPilot mocked e2e smoke test passed"
